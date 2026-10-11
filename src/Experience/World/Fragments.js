import * as THREE from 'three/webgpu'
import RAPIER from '@dimforge/rapier3d-compat'
import Experience from '../Experience.js'

/**
 * Smaller rocks that fall on the main rock and stick to it.
 *
 * Each one is a Rapier rigid body with a convex hull collider built from its
 * own vertices, so it lands, tumbles and rests on its real shape. There is no
 * global gravity: on every frame each body is pulled towards the origin.
 *
 * A fragment that stays still while touching something static gets stuck: its
 * body becomes fixed, and the next ones can pile on top of it.
 *
 * Everything lives in the space of the rock pivot (meshes are children of it,
 * and so is the physics world): stuck fragments spin with the rock for free.
 *
 * Receives the rock by parameter because World is still being built when this
 * is created (experience.world may not exist yet).
 */
export default class Fragments
{
    constructor(rock)
    {
        this.experience = new Experience()
        this.resources = this.experience.resources
        this.time = this.experience.time
        this.camera = this.experience.camera
        this.renderer = this.experience.renderer
        this.physics = this.experience.physics
        this.debug = this.experience.debug

        this.rock = rock

        this.parameters = {
            delay: 5,         // Seconds before the fragments are launched
            spawnMargin: 2.5, // How far beyond the edge of the screen they start
            spin: 1.2,        // Maximum tumbling speed at launch (rad/s)
            gravity: 1.6,     // Acceleration towards the centre (units/s²)
            damping: 0.4,     // Linear and angular velocity lost per second while flying
            grip: 10,         // Same, while touching something static: what makes them stick instead of roll
            bounce: 0.15,     // Restitution
            friction: 1,
            stickSpeed: 0.15, // Below this speed (units/s) a resting fragment counts as still...
            stickTime: 0.3    // ...and after this many seconds still, it gets stuck
        }

        // One entry per model; "count" instances of each
        this.types = [
            { resource: 'rock01Model', count: 1 },
            { resource: 'rock02Model', count: 1 },
            { resource: 'rock03Model', count: 1 }
        ]

        this.isLaunched = false

        // Reused in update()
        this.position = new THREE.Vector3()
        this.quaternion = new THREE.Quaternion()
        this.scale = new THREE.Vector3(1, 1, 1)
        this.matrix = new THREE.Matrix4()

        this.setTypes()
        this.setBodies()
        this.setSurface()
        this.setDebug()
    }

    /**
     * Geometry, hull points and instanced mesh of each model.
     */
    setTypes()
    {
        const anisotropy = Math.min(8, this.renderer.instance.getMaxAnisotropy())
        const vertex = new THREE.Vector3()

        // Parked far above (beyond the camera far plane) until launch()
        this.matrix.makeTranslation(0, 1000, 0)

        for(const type of this.types)
        {
            const model = this.resources.items[ type.resource ].scene
            let source = null

            model.updateMatrixWorld(true)
            model.traverse((child) =>
            {
                if(child.isMesh && !source)
                    source = child
            })

            // Geometry centred on the origin, which is where its body is
            type.geometry = source.geometry
            type.geometry.applyMatrix4(source.matrixWorld)
            type.geometry.center()
            type.geometry.computeBoundingSphere()
            type.radius = type.geometry.boundingSphere.radius

            // Rapier builds the convex hull from these points
            const position = type.geometry.attributes.position
            type.points = new Float32Array(position.count * 3)

            for(let i = 0; i < position.count; i++)
                vertex.fromBufferAttribute(position, i).toArray(type.points, i * 3)

            // Material exactly as exported from Blender, like the main rock
            type.material = source.material
            type.textures = [ type.material.map, type.material.normalMap, type.material.aoMap ].filter(Boolean)

            for(const texture of type.textures)
            {
                texture.anisotropy = anisotropy
                texture.needsUpdate = true
            }

            type.mesh = new THREE.InstancedMesh(type.geometry, type.material, type.count)
            type.mesh.name = type.resource
            type.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
            type.mesh.frustumCulled = false // Its bounds know nothing about where the instances are

            for(let i = 0; i < type.count; i++)
                type.mesh.setMatrixAt(i, this.matrix)

            this.rock.pivot.add(type.mesh)
        }
    }

    /**
     * One rigid body per instance, disabled until launch().
     */
    setBodies()
    {
        const world = this.physics.instance

        this.items = []

        for(const type of this.types)
        {
            // convexHull() returns null if the points are degenerate
            const colliderDesc = RAPIER.ColliderDesc.convexHull(type.points) ?? RAPIER.ColliderDesc.ball(type.radius)

            for(let index = 0; index < type.count; index++)
            {
                const body = world.createRigidBody(
                    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1000, 0).setCcdEnabled(true).setEnabled(false)
                )
                const collider = world.createCollider(colliderDesc, body)

                this.items.push({ type, index, body, collider, isStuck: true, stillTime: 0 })
            }
        }
    }

    /**
     * Applies the contact parameters to every collider, including the one of
     * the main rock (Rapier averages both sides of a contact).
     */
    setSurface()
    {
        const { bounce, friction } = this.parameters

        this.rock.collider.setRestitution(bounce)
        this.rock.collider.setFriction(friction)

        for(const item of this.items)
        {
            item.collider.setRestitution(bounce)
            item.collider.setFriction(friction)
        }
    }

    /**
     * Places the fragments around the main rock, just outside the screen, and
     * lets them fall. Called once after the delay; the debug UI can repeat it.
     */
    launch()
    {
        const camera = this.camera.instance
        const pivot = this.rock.pivot

        camera.updateMatrixWorld()
        pivot.updateMatrixWorld()

        // Size of the screen at the depth of the rock
        const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.length()
        const halfWidth = halfHeight * camera.aspect

        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
        const position = new THREE.Vector3()
        const quaternion = new THREE.Quaternion()
        const spin = new THREE.Vector3()
        const startAngle = Math.random() * Math.PI * 2

        this.items.forEach((item, i) =>
        {
            // Spread around the screen, each one a bit further than the edge
            const angle = startAngle + ((i + (Math.random() - 0.5) * 0.5) / this.items.length) * Math.PI * 2
            const cos = Math.cos(angle)
            const sin = Math.sin(angle)
            const edge = Math.min(halfWidth / Math.abs(cos), halfHeight / Math.abs(sin))
            const distance = edge + this.parameters.spawnMargin * (1 + Math.random() * 0.5)

            position.set(0, 0, 0).addScaledVector(right, cos * distance).addScaledVector(up, sin * distance)
            pivot.worldToLocal(position)

            quaternion.random()
            spin.randomDirection().multiplyScalar(this.parameters.spin * (0.4 + Math.random() * 0.6))

            item.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
            item.body.setEnabled(true)
            item.body.setTranslation(position, true)
            item.body.setRotation(quaternion, true)
            item.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
            item.body.setAngvel(spin, true)

            item.isStuck = false
            item.stillTime = 0
        })

        this.isLaunched = true
    }

    /**
     * True when the collider is in contact with a fixed body: the main rock
     * or a fragment that is already stuck.
     */
    isTouchingStatic(collider)
    {
        const world = this.physics.instance
        let isTouching = false

        world.contactPairsWith(collider, (other) =>
        {
            if(isTouching || !other.parent().isFixed())
                return

            world.contactPair(collider, other, (manifold) =>
            {
                if(manifold.numContacts() > 0)
                    isTouching = true
            })
        })

        return isTouching
    }

    setDebug()
    {
        if(!this.debug.active)
            return

        const folder = this.debug.ui.addFolder('fragments')
        const setSurface = () => this.setSurface()

        folder.add(this.parameters, 'gravity').min(0).max(10).step(0.01)
        folder.add(this.parameters, 'damping').min(0).max(5).step(0.01)
        folder.add(this.parameters, 'grip').min(0).max(30).step(0.1)
        folder.add(this.parameters, 'bounce').min(0).max(1).step(0.01).onChange(setSurface)
        folder.add(this.parameters, 'friction').min(0).max(3).step(0.01).onChange(setSurface)
        folder.add(this.parameters, 'stickSpeed').min(0).max(1).step(0.001).name('stick speed')
        folder.add(this.parameters, 'stickTime').min(0).max(2).step(0.01).name('stick time')
        folder.add(this.parameters, 'spawnMargin').min(0).max(10).step(0.1).name('spawn margin')
        folder.add(this.parameters, 'spin').min(0).max(6).step(0.01)
        folder.add(this, 'launch')

        // Wireframe of every collider, as Rapier sees them
        this.helper = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: '#1b5f75', depthTest: false })
        )
        this.helper.visible = false
        this.helper.frustumCulled = false
        this.rock.pivot.add(this.helper)

        folder.add(this.helper, 'visible').name('show colliders')
    }

    updateHelper()
    {
        const { vertices } = this.physics.instance.debugRender()
        const attribute = this.helper.geometry.attributes.position

        if(attribute && attribute.array.length === vertices.length)
        {
            attribute.array.set(vertices)
            attribute.needsUpdate = true
        }
        else
        {
            this.helper.geometry.dispose()
            this.helper.geometry = new THREE.BufferGeometry()
            this.helper.geometry.setAttribute('position', new THREE.BufferAttribute(vertices.slice(), 3))
        }
    }

    /**
     * Runs after the physics step of the frame (see Experience.update()).
     */
    update()
    {
        if(!this.isLaunched && this.time.elapsed >= this.parameters.delay)
            this.launch()

        const delta = this.physics.instance.timestep

        for(const item of this.items)
        {
            if(item.isStuck)
                continue

            // Mesh
            this.position.copy(item.body.translation())
            this.quaternion.copy(item.body.rotation())
            this.matrix.compose(this.position, this.quaternion, this.scale)
            item.type.mesh.setMatrixAt(item.index, this.matrix)
            item.type.mesh.instanceMatrix.needsUpdate = true

            // Touching the main rock or a stuck fragment: grip
            const isTouching = this.isTouchingStatic(item.collider)
            const damping = isTouching ? this.parameters.grip : this.parameters.damping

            item.body.setLinearDamping(damping)
            item.body.setAngularDamping(damping)

            // Still for long enough while touching: stick
            const linvel = item.body.linvel()
            const angvel = item.body.angvel()
            const speed = Math.hypot(linvel.x, linvel.y, linvel.z) + Math.hypot(angvel.x, angvel.y, angvel.z) * item.type.radius

            if(isTouching && speed < this.parameters.stickSpeed)
                item.stillTime += delta
            else
                item.stillTime = 0

            if(item.stillTime >= this.parameters.stickTime)
            {
                item.body.setBodyType(RAPIER.RigidBodyType.Fixed, false)
                item.isStuck = true

                continue
            }

            // Centre gravity, as an impulse for the next physics step
            const strength = this.parameters.gravity * item.body.mass() * delta / Math.max(this.position.length(), 1e-6)

            item.body.applyImpulse({
                x: - this.position.x * strength,
                y: - this.position.y * strength,
                z: - this.position.z * strength
            }, true)
        }

        if(this.helper?.visible)
            this.updateHelper()
    }

    destroy()
    {
        // The bodies are freed with the physics world
        for(const type of this.types)
        {
            this.rock.pivot.remove(type.mesh)

            type.mesh.dispose()
            type.geometry.dispose()
            type.material.dispose()

            for(const texture of type.textures)
                texture.dispose()
        }

        if(this.helper)
        {
            this.rock.pivot.remove(this.helper)

            this.helper.geometry.dispose()
            this.helper.material.dispose()
        }
    }
}
