import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

/**
 * The rock model (rockDemo_00.glb).
 *
 * - The GLB is self-contained: GLTFLoader builds the "Rock" material with its
 *   embedded diffuse / normal / occlusion maps (flipY, colour spaces and the
 *   normal map convention already handled). Roughness (0.9) comes from Blender.
 *   Only texture anisotropy is adjusted here (glTF has no setting for it).
 * - The model is wrapped in a pivot group and offset so its centre sits on
 *   the rotation axis: the pivot spins, the model never drifts.
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
        this.debug = this.experience.debug

        this.resource = this.resources.items.rockModel

        this.parameters = {
            rotationSpeed: 0.12 // Radians per second (~52 s per turn)
        }

        this.setModel()
        this.setMaterial()
        this.setTextures()
        this.setDimensions()
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
    }

    update()
    {
        this.pivot.rotation.y += this.parameters.rotationSpeed * this.time.delta
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
