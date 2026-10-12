import * as THREE from 'three/webgpu'
import RAPIER from '@dimforge/rapier3d-compat'
import Experience from '../Experience.js'
import RockInstances from './RockInstances.js'
import Sway from './Sway.js'

/**
 * Smaller rocks that fall on the main rock and stick to it.
 *
 * Each one is a Rapier rigid body with a convex hull collider built from its
 * own vertices, so it lands, tumbles and rests on its real shape. There is no
 * global gravity: on every frame each body is pulled towards the origin.
 *
 * A fragment that stays still while touching something static gets stuck: its
 * body becomes fixed, and the next ones can pile on top of it. From then on
 * the pointer can nudge it, a bit more than it nudges the main rock; that is
 * only visual, the body stays where it got stuck.
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
        this.time = this.experience.time
        this.camera = this.experience.camera
        this.physics = this.experience.physics
        this.debug = this.experience.debug
        this.panel = this.experience.panel

        this.rock = rock

        this.parameters = {
            delay: 5,         // Seconds before the fragments are launched
            spawnMargin: 4.9, // How far beyond the edge of the screen they start
            spawnMax: 24.3,   // Furthest start; the ones coming from the back can't start off screen
            appearTime: 3,    // Seconds they take to grow to full size (hides the ones that start in view)
            spin: 1.04,       // Maximum tumbling speed at launch (rad/s)
            gravity: 5.29,    // Acceleration towards the centre (units/s²)
            damping: 1.18,    // Linear and angular velocity lost per second while flying
            grip: 3.3,        // Same, while touching something static: what makes them stick instead of roll
            bounce: 0.38,     // Restitution
            friction: 0.14,
            stickSpeed: 1,    // Below this speed (units/s) a resting fragment counts as still...
            stickTime: 2,     // ...and after this many seconds still, it gets stuck
            hitSpeed: 0.3,    // Speed lost in one frame (units/s) for a contact to count as a hit on the rock
            pointerPush: 0.7,   // How much of the pointer's speed a stuck fragment picks up, on top of what the rock moves
            pointerTilt: 8,     // Same for the tipping
            pointerRadius: 0.45 // How far from the centre of a fragment the pointer still reaches it
        }

        // One entry per model; "count" instances of each
        this.types = [
            { resource: 'rock01Model', count: 1 },
            { resource: 'rock02Model', count: 1 },
            { resource: 'rock03Model', count: 1 },
            { resource: 'rock04Model', count: 1 },
            { resource: 'rock05Model', count: 1 },
            { resource: 'rock06Model', count: 1 },
            { resource: 'rock07Model', count: 1 },
            { resource: 'rock08Model', count: 1 }
        ]

        this.isLaunched = false
        this.isSettled = false // True once every fragment is stuck

        // Reused in update()
        this.position = new THREE.Vector3()
        this.quaternion = new THREE.Quaternion()
        this.scale = new THREE.Vector3(1, 1, 1)
        this.matrix = new THREE.Matrix4()
        this.swayMatrix = new THREE.Matrix4()
        this.impulse = new THREE.Vector3()
        this.centre = new THREE.Vector3()
        this.lever = new THREE.Vector3()
        this.pointerVelocity = new THREE.Vector3()
        this.toPivot = new THREE.Quaternion()
        this.swayQuaternion = new THREE.Quaternion()

        this.setTypes()
        this.setBodies()
        this.setSurface()
        this.setDebug()
        this.setPanel()
    }

    /**
     * Instanced mesh of each model, in the space of the rock pivot.
     */
    setTypes()
    {
        for(const type of this.types)
        {
            type.instances = new RockInstances(type.resource, type.count, this.rock.pivot)
            type.radius = type.instances.radius
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
            const colliderDesc = type.instances.createColliderDesc()

            for(let index = 0; index < type.count; index++)
            {
                const body = world.createRigidBody(
                    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1000, 0).setCcdEnabled(true).setEnabled(false)
                )
                const collider = world.createCollider(colliderDesc, body)

                this.items.push({ type, index, body, collider, isStuck: true, stillTime: 0, age: 0, velocity: new THREE.Vector3(), sway: new Sway() })
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
     * Places the fragments all around the main rock, as if it were the centre
     * of a sphere, and lets them fall. Each one starts as close as it can
     * while still being off screen. Called once after the delay; the debug UI
     * can repeat it.
     */
    launch()
    {
        const camera = this.camera.instance
        const pivot = this.rock.pivot

        camera.updateMatrixWorld()
        pivot.updateMatrixWorld()

        const toCamera = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2)

        // Nothing comes straight through the lens: directions inside this cone
        // around the camera are pushed to its edge
        const cameraCone = THREE.MathUtils.degToRad(30)

        const direction = new THREE.Vector3()
        const sideways = new THREE.Vector3()
        const position = new THREE.Vector3()
        const quaternion = new THREE.Quaternion()
        const spin = new THREE.Vector3()
        const turn = new THREE.Quaternion().random() // A different arrangement on every launch
        const count = this.items.length

        this.items.forEach((item, i) =>
        {
            // Evenly spread over the sphere (Fibonacci lattice)
            const y = 1 - ((i + 0.5) / count) * 2
            const ring = Math.sqrt(1 - y * y)
            const angle = i * Math.PI * (3 - Math.sqrt(5))

            direction.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring).applyQuaternion(turn)

            const towardsCamera = direction.dot(toCamera)

            if(towardsCamera > Math.cos(cameraCone))
            {
                sideways.copy(direction).addScaledVector(toCamera, - towardsCamera)

                if(sideways.lengthSq() < 1e-8)
                    sideways.setFromMatrixColumn(camera.matrixWorld, 0)

                sideways.normalize()
                direction.copy(toCamera).multiplyScalar(Math.cos(cameraCone)).addScaledVector(sideways, Math.sin(cameraCone))
            }

            // As close as it can be while still off screen. Towards the back
            // it never is, hence the maximum
            const edge = this.camera.getExitDistance(direction)
            const distance = Math.min(edge + this.parameters.spawnMargin * (1 + Math.random() * 0.5), this.parameters.spawnMax)

            position.copy(direction).multiplyScalar(distance)
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
            item.age = 0
            item.velocity.set(0, 0, 0)
            item.sway.reset()
        })

        this.isLaunched = true
        this.isSettled = false
    }

    /**
     * Radius of the sphere, centred on the main rock, that contains the rock
     * and every fragment stuck to it. Orbiters.js stays out of it.
     */
    getReach()
    {
        let reach = Math.hypot(this.rock.dimensions.halfHeight, this.rock.dimensions.radius)

        if(!this.isLaunched)
            return reach

        for(const item of this.items)
        {
            if(item.isStuck)
                reach = Math.max(reach, this.position.copy(item.body.translation()).length() + item.type.radius)
        }

        return reach
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

    /**
     * Lets the pointer nudge a stuck fragment and brings it back. Expects
     * this.position / this.quaternion to hold its pose, and displaces them.
     */
    updateSway(item, delta)
    {
        const cursor = this.rock.cursor

        if(cursor.isMoving)
        {
            // How close the pointer passes to the fragment, on screen
            const ray = cursor.raycaster.ray
            const reach = this.parameters.pointerRadius

            this.centre.copy(this.position).applyMatrix4(this.rock.pivot.matrixWorld)

            const influence = 1 - THREE.MathUtils.smoothstep(ray.distanceToPoint(this.centre), reach * 0.4, reach)

            if(influence > 0)
            {
                // Where it is pushed (relative to its centre) and how, in pivot space
                ray.closestPointToPoint(this.centre, this.lever).sub(this.centre).applyQuaternion(this.toPivot)
                this.pointerVelocity.copy(cursor.velocity).applyQuaternion(this.toPivot)

                item.sway.push(this.lever, this.pointerVelocity, this.parameters.pointerPush * influence * delta, this.parameters.pointerTilt * influence * delta)
            }
        }

        // Same spring as the main rock
        item.sway.update(delta, this.rock.parameters.recoverFrequency, this.rock.parameters.recoverDamping)

        this.position.add(item.sway.offset)
        this.quaternion.premultiply(item.sway.getQuaternion(this.swayQuaternion))
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
        folder.add(this.parameters, 'stickSpeed').min(0).max(3).step(0.001).name('stick speed')
        folder.add(this.parameters, 'stickTime').min(0).max(5).step(0.01).name('stick time')
        folder.add(this.parameters, 'spawnMargin').min(0).max(10).step(0.1).name('spawn margin')
        folder.add(this.parameters, 'spawnMax').min(2).max(30).step(0.1).name('spawn max')
        folder.add(this.parameters, 'appearTime').min(0).max(6).step(0.01).name('appear time')
        folder.add(this.parameters, 'spin').min(0).max(6).step(0.01)
        folder.add(this.parameters, 'pointerPush').min(0).max(6).step(0.01).name('pointer push')
        folder.add(this.parameters, 'pointerTilt').min(0).max(30).step(0.1).name('pointer tilt')
        folder.add(this.parameters, 'pointerRadius').min(0.1).max(2).step(0.01).name('pointer radius')
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
     * What the visitor can play with. Gravity, damping and grip are read on
     * every frame, so they only show on the next launch.
     */
    setPanel()
    {
        if(!this.panel.active)
            return

        const folder = this.panel.ui.addFolder('Rocks')
        const setSurface = () => this.setSurface()

        folder.add(this.parameters, 'gravity').min(0.5).max(10).step(0.01).name('Gravity')
        folder.add(this.parameters, 'damping').min(0).max(3).step(0.01).name('Damping')
        folder.add(this.parameters, 'grip').min(0.5).max(15).step(0.1).name('Grip')
        folder.add(this.parameters, 'bounce').min(0).max(0.9).step(0.01).name('Bounce').onChange(setSurface)
        folder.add(this.parameters, 'friction').min(0).max(1.5).step(0.01).name('Friction').onChange(setSurface)
    }

    /**
     * Runs after the physics step of the frame (see Experience.update()).
     */
    update()
    {
        if(this.helper?.visible)
            this.updateHelper()

        if(!this.isLaunched && this.time.elapsed >= this.parameters.delay)
            this.launch()

        // Nothing to move while they are parked
        if(!this.isLaunched)
            return

        const delta = this.physics.instance.timestep

        // Rock.update() has just moved the pivot
        this.rock.pivot.updateMatrixWorld()
        this.toPivot.copy(this.rock.pivot.quaternion).invert()

        for(const item of this.items)
        {
            // Mesh, growing from nothing right after the launch
            item.age += delta

            this.position.copy(item.body.translation())
            this.quaternion.copy(item.body.rotation())
            this.scale.setScalar(THREE.MathUtils.smoothstep(item.age, 0, this.parameters.appearTime))

            if(item.isStuck)
                this.updateSway(item, delta)

            this.matrix.compose(this.position, this.quaternion, this.scale)

            // The meshes are children of the pivot, which sways when the rock
            // is hit: undo that for the ones that are still far from it
            const independence = item.isStuck ? 0 : THREE.MathUtils.smoothstep(this.position.length(), 1.5, 3.5)

            if(independence > 0)
                this.matrix.premultiply(this.rock.sway.getMatrix(this.swayMatrix, independence).invert())

            item.type.instances.mesh.setMatrixAt(item.index, this.matrix)
            item.type.instances.mesh.instanceMatrix.needsUpdate = true

            if(item.isStuck)
                continue

            // Touching the main rock or a stuck fragment: grip
            const isTouching = this.isTouchingStatic(item.collider)
            const damping = isTouching ? this.parameters.grip : this.parameters.damping

            item.body.setLinearDamping(damping)
            item.body.setAngularDamping(damping)

            // A sudden loss of speed against something static is a hit: the
            // rock receives the momentum the fragment lost
            const linvel = item.body.linvel()

            this.impulse.copy(item.velocity).sub(linvel)
            item.velocity.copy(linvel)

            if(isTouching && this.impulse.length() > this.parameters.hitSpeed)
                this.rock.hit(this.position, this.impulse.multiplyScalar(item.body.mass()))

            // Still for long enough while touching: stick
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

        this.isSettled = this.items.every((item) => item.isStuck)
    }

    destroy()
    {
        // The bodies are freed with the physics world
        for(const type of this.types)
            type.instances.destroy()

        if(this.helper)
        {
            this.rock.pivot.remove(this.helper)

            this.helper.geometry.dispose()
            this.helper.material.dispose()
        }
    }
}
