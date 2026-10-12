import * as THREE from 'three/webgpu'
import RAPIER from '@dimforge/rapier3d-compat'
import Experience from '../Experience.js'
import Sway from './Sway.js'

const _up = new THREE.Vector3(0, 1, 0)
const _vector = new THREE.Vector3()
const _velocity = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()
const _pointer = new THREE.Vector2()

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
 *   damped spring brings it back. Moving the pointer over the rock drags it
 *   along in the same way. It is only visual: in the physics world the rock
 *   never moves.
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
        this.camera = this.experience.camera
        this.pointer = this.experience.pointer
        this.debug = this.experience.debug

        this.resource = this.resources.items.rockModel

        this.parameters = {
            rotationSpeed: 0.12,   // Radians per second (~52 s per turn)
            hitPush: 4,            // Speed the rock gains per unit of momentum it receives
            hitTilt: 15,           // Same for the tipping: angular speed per unit of angular momentum
            recoverFrequency: 1.2, // Swings per second while it goes back to its place
            recoverDamping: 0.35,  // 0 = swings forever, 1 = goes back without overshooting
            pointerPush: 1.2,      // How much of the pointer's speed the rock picks up while it passes over it
            pointerTilt: 1.7,      // Same for the tipping
            pointerRadius: 0.9     // How far from the centre of the rock the pointer still reaches it
        }

        // Displacement caused by the hits, in pivot space
        this.spin = 0
        this.sway = new Sway()

        // Pointer projected on the plane that faces the camera through the
        // centre, in world space. Fragments.js reads it too
        this.cursor = {
            raycaster: new THREE.Raycaster(),
            plane: new THREE.Plane(),
            position: new THREE.Vector3(),
            previous: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            hasPrevious: false,
            isMoving: false // True on the frames in which the pointer can push things
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
        folder.add(this.parameters, 'pointerPush').min(0).max(6).step(0.01).name('pointer push')
        folder.add(this.parameters, 'pointerTilt').min(0).max(10).step(0.01).name('pointer tilt')
        folder.add(this.parameters, 'pointerRadius').min(0.1).max(3).step(0.01).name('pointer radius')
    }

    /**
     * Something hit the rock. Both vectors in pivot space.
     *
     * @param {THREE.Vector3} point   Where, relative to the centre
     * @param {THREE.Vector3} impulse Momentum the rock receives
     */
    hit(point, impulse)
    {
        this.sway.push(point, impulse, this.parameters.hitPush, this.parameters.hitTilt)
    }

    /**
     * Lets the pointer drag the rock: while it moves near the centre, the
     * rock picks up part of its speed. Not while a button is down, because
     * that is OrbitControls turning the camera.
     */
    updatePointer(delta)
    {
        const { raycaster, plane, position, previous, velocity } = this.cursor

        this.cursor.isMoving = false

        if(!this.pointer.isInside)
        {
            this.cursor.hasPrevious = false

            return
        }

        // Where the pointer is in 3D
        raycaster.setFromCamera(_pointer.set(this.pointer.x, this.pointer.y), this.camera.instance)
        plane.normal.copy(this.camera.instance.position).normalize()

        if(!raycaster.ray.intersectPlane(plane, position))
        {
            this.cursor.hasPrevious = false

            return
        }

        if(this.cursor.hasPrevious && !this.pointer.isDown && delta > 0)
        {
            // Speed of the pointer, capped so a flick can't throw anything away
            velocity.copy(position).sub(previous).divideScalar(delta).clampLength(0, 8)
            this.cursor.isMoving = true

            // Full effect over the rock, fading to nothing at pointerRadius
            const reach = this.parameters.pointerRadius
            const influence = 1 - THREE.MathUtils.smoothstep(position.length(), reach * 0.4, reach)

            if(influence > 0)
            {
                // World to pivot space, which only differs by the spin
                _quaternion.setFromAxisAngle(_up, - this.spin)
                _velocity.copy(velocity).applyQuaternion(_quaternion)
                _vector.copy(position).applyQuaternion(_quaternion)

                this.sway.push(_vector, _velocity, this.parameters.pointerPush * influence * delta, this.parameters.pointerTilt * influence * delta)
            }
        }

        previous.copy(position)
        this.cursor.hasPrevious = true
    }

    update()
    {
        const delta = this.time.delta

        this.spin += this.parameters.rotationSpeed * delta

        this.updatePointer(delta)
        this.sway.update(delta, this.parameters.recoverFrequency, this.parameters.recoverDamping)

        // Spin around Y, then the displacement inside the spinning space
        this.pivot.quaternion.setFromAxisAngle(_up, this.spin)
        this.pivot.position.copy(this.sway.offset).applyQuaternion(this.pivot.quaternion)
        this.pivot.quaternion.multiply(this.sway.getQuaternion(_quaternion))
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
