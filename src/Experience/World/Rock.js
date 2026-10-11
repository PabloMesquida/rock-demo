import * as THREE from 'three/webgpu'
import RAPIER from '@dimforge/rapier3d-compat'
import Experience from '../Experience.js'

const _up = new THREE.Vector3(0, 1, 0)
const _scale = new THREE.Vector3(1, 1, 1)
const _vector = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()

/**
 * The rock model (rockDemo_00.glb).
 *
 * - The GLB is self-contained: GLTFLoader builds the "Rock" material with its
 *   embedded diffuse / normal / occlusion maps (flipY, colour spaces and the
 *   normal map convention already handled). Roughness (0.9) comes from Blender.
 *   Only texture anisotropy is adjusted here (glTF has no setting for it).
 * - The model is wrapped in a pivot group and offset so its centre sits on
 *   the rotation axis: the pivot spins, the model never drifts.
 * - A hit (World/Fragments.js) knocks the pivot a little off its place and a
 *   damped spring brings it back. It is only visual: in the physics world
 *   the rock never moves.
 */
export default class Rock
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources
        this.time = this.experience.time
        this.renderer = this.experience.renderer
        this.physics = this.experience.physics
        this.debug = this.experience.debug

        this.resource = this.resources.items.rockModel

        this.parameters = {
            rotationSpeed: 0.12,   // Radians per second (~52 s per turn)
            hitPush: 4,            // Speed the rock gains per unit of momentum it receives
            hitTilt: 15,           // Same for the tipping: angular speed per unit of angular momentum
            recoverFrequency: 1.2, // Swings per second while it goes back to its place
            recoverDamping: 0.35   // 0 = swings forever, 1 = goes back without overshooting
        }

        // Displacement caused by the hits, in pivot space
        this.spin = 0
        this.sway = {
            offset: new THREE.Vector3(),
            offsetVelocity: new THREE.Vector3(),
            tilt: new THREE.Vector3(), // Rotation vector: direction = axis, length = angle
            tiltVelocity: new THREE.Vector3()
        }

        this.setModel()
        this.setMaterial()
        this.setTextures()
        this.setDimensions()
        this.setCollider()
        this.setDebug()
    }

    setModel()
    {
        this.model = this.resource.scene

        this.model.traverse((child) =>
        {
            if(child.isMesh && !this.mesh)
                this.mesh = child
        })

        this.mesh.castShadow = true
        this.mesh.receiveShadow = true

        // Centre the model on the origin (the GLB node is translated ~1.97 on X)
        this.model.updateMatrixWorld(true)
        const center = new THREE.Box3().setFromObject(this.model).getCenter(new THREE.Vector3())
        this.model.position.sub(center)

        // The pivot is what rotates; the model keeps its own transform
        this.pivot = new THREE.Group()
        this.pivot.name = 'rockPivot'
        this.pivot.add(this.model)
        this.scene.add(this.pivot)
    }

    setMaterial()
    {
        // Material exactly as exported from Blender, maps included
        this.material = this.mesh.material

        // The mesh has no tangents, so GLTFLoader set normalScale to (1, -1):
        // the convention for glTF (OpenGL, +Y) normal maps with derivative-based
        // tangents. Only its magnitude is exposed in the debug UI.
        this.normalStrength = Math.abs(this.material.normalScale.x)
    }

    setTextures()
    {
        // Sharper maps at grazing angles (edges of the spinning rock)
        const anisotropy = Math.min(8, this.renderer.instance.getMaxAnisotropy())

        this.textures = {
            color: this.material.map,
            normal: this.material.normalMap,
            ao: this.material.aoMap
        }

        for(const key in this.textures)
        {
            const texture = this.textures[ key ]

            if(!texture)
            {
                console.warn(`Rock: the GLB material has no ${key} texture`)
                continue
            }

            texture.anisotropy = anisotropy
            texture.needsUpdate = true
        }
    }

    /**
     * Dimensions relevant for a model spinning around Y: half height and the
     * largest horizontal distance to the rotation axis.
     */
    setDimensions()
    {
        this.pivot.updateMatrixWorld(true)

        const position = this.mesh.geometry.attributes.position
        const vertex = new THREE.Vector3()
        const box = new THREE.Box3()
        let radius = 0

        for(let i = 0; i < position.count; i++)
        {
            vertex.fromBufferAttribute(position, i).applyMatrix4(this.mesh.matrixWorld)
            box.expandByPoint(vertex)
            radius = Math.max(radius, Math.hypot(vertex.x, vertex.z))
        }

        this.dimensions = {
            halfHeight: Math.max(Math.abs(box.min.y), Math.abs(box.max.y)),
            radius
        }
    }

    /**
     * Static collider with the exact triangles of the mesh, in pivot space
     * (the pivot has no rotation yet, so world = pivot space). The physics
     * world lives in that space, which is why the body never has to move.
     */
    setCollider()
    {
        const position = this.mesh.geometry.attributes.position
        const vertices = new Float32Array(position.count * 3)
        const vertex = new THREE.Vector3()

        for(let i = 0; i < position.count; i++)
            vertex.fromBufferAttribute(position, i).applyMatrix4(this.mesh.matrixWorld).toArray(vertices, i * 3)

        const indices = new Uint32Array(this.mesh.geometry.index.array)

        // FIX_INTERNAL_EDGES: bodies sliding over the surface don't trip on
        // the edges between triangles
        this.body = this.physics.instance.createRigidBody(RAPIER.RigidBodyDesc.fixed())
        this.collider = this.physics.instance.createCollider(
            RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES),
            this.body
        )
    }

    setDebug()
    {
        if(!this.debug.active)
            return

        const folder = this.debug.ui.addFolder('rock')
        folder.add(this.parameters, 'rotationSpeed').min(0).max(1).step(0.001)
        folder.add(this, 'normalStrength').min(0).max(3).step(0.01).name('normal strength').onChange((value) =>
        {
            this.material.normalScale.set(value, - value)
        })
        folder.add(this.material, 'aoMapIntensity').min(0).max(2).step(0.01).name('ao intensity')
        folder.add(this.material, 'roughness').min(0).max(1).step(0.001)
        folder.add(this.parameters, 'hitPush').min(0).max(15).step(0.01).name('hit push')
        folder.add(this.parameters, 'hitTilt').min(0).max(60).step(0.1).name('hit tilt')
        folder.add(this.parameters, 'recoverFrequency').min(0.2).max(5).step(0.01).name('recover frequency')
        folder.add(this.parameters, 'recoverDamping').min(0).max(1).step(0.01).name('recover damping')
    }

    /**
     * Something hit the rock. Both vectors in pivot space.
     *
     * @param {THREE.Vector3} point   Where, relative to the centre
     * @param {THREE.Vector3} impulse Momentum the rock receives
     */
    hit(point, impulse)
    {
        this.sway.offsetVelocity.addScaledVector(impulse, this.parameters.hitPush)
        this.sway.tiltVelocity.addScaledVector(_vector.crossVectors(point, impulse), this.parameters.hitTilt)
    }

    /**
     * Current displacement as a matrix in pivot space. "amount" scales it:
     * Fragments.js uses it to keep the rocks that are still far away from
     * swaying with the pivot they are children of.
     */
    getSwayMatrix(amount, target)
    {
        const angle = this.sway.tilt.length() * amount

        _quaternion.setFromAxisAngle(_vector.copy(this.sway.tilt).normalize(), angle)

        return target.compose(_vector.copy(this.sway.offset).multiplyScalar(amount), _quaternion, _scale)
    }

    update()
    {
        const delta = this.time.delta
        const { offset, offsetVelocity, tilt, tiltVelocity } = this.sway

        this.spin += this.parameters.rotationSpeed * delta

        // Damped spring back to rest, for the position and for the tilt
        const frequency = this.parameters.recoverFrequency * Math.PI * 2
        const stiffness = frequency * frequency
        const damping = this.parameters.recoverDamping * frequency * 2

        offsetVelocity.addScaledVector(offset, - stiffness * delta).addScaledVector(offsetVelocity, - damping * delta)
        offset.addScaledVector(offsetVelocity, delta)

        tiltVelocity.addScaledVector(tilt, - stiffness * delta).addScaledVector(tiltVelocity, - damping * delta)
        tilt.addScaledVector(tiltVelocity, delta)

        // Spin around Y, then the displacement inside the spinning space
        this.pivot.quaternion.setFromAxisAngle(_up, this.spin)
        this.pivot.position.copy(offset).applyQuaternion(this.pivot.quaternion)
        this.pivot.quaternion.multiply(_quaternion.setFromAxisAngle(_vector.copy(tilt).normalize(), tilt.length()))
    }

    destroy()
    {
        this.scene.remove(this.pivot)

        this.mesh.geometry.dispose()
        this.material.dispose()

        for(const key in this.textures)
            this.textures[ key ]?.dispose()
    }
}
