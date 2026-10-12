import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

/**
 * Every instance of one rock model, drawn as a single InstancedMesh.
 *
 * The geometry is centred on the origin so each instance turns around its own
 * centre, and the material is the one exported from Blender, like the main
 * rock. Instances start parked far above (beyond the camera far plane) until
 * their owner places them with mesh.setMatrixAt().
 *
 * Used by Fragments.js and Orbiters.js, which decide how the instances move.
 */
export default class RockInstances
{
    /**
     * @param {string} resource Name of the model in sources.js
     * @param {number} count
     * @param {THREE.Object3D} parent The instances live in its space
     */
    constructor(resource, count, parent)
    {
        this.experience = new Experience()
        this.resources = this.experience.resources
        this.renderer = this.experience.renderer

        this.resource = resource
        this.count = count
        this.parent = parent

        this.setSource()
        this.setGeometry()
        this.setMaterial()
        this.setMesh()
    }

    setSource()
    {
        const model = this.resources.items[ this.resource ].scene

        model.updateMatrixWorld(true)
        model.traverse((child) =>
        {
            if(child.isMesh && !this.source)
                this.source = child
        })
    }

    setGeometry()
    {
        this.geometry = this.source.geometry
        this.geometry.applyMatrix4(this.source.matrixWorld)
        this.geometry.center()
        this.geometry.computeBoundingSphere()

        this.radius = this.geometry.boundingSphere.radius
    }

    setMaterial()
    {
        const anisotropy = Math.min(8, this.renderer.instance.getMaxAnisotropy())

        this.material = this.source.material
        this.textures = [ this.material.map, this.material.normalMap, this.material.aoMap ].filter(Boolean)

        for(const texture of this.textures)
        {
            texture.anisotropy = anisotropy
            texture.needsUpdate = true
        }
    }

    setMesh()
    {
        const parked = new THREE.Matrix4().makeTranslation(0, 1000, 0)

        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count)
        this.mesh.name = this.resource
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.mesh.frustumCulled = false // Its bounds know nothing about where the instances are
        this.mesh.castShadow = true
        this.mesh.receiveShadow = true

        for(let i = 0; i < this.count; i++)
            this.mesh.setMatrixAt(i, parked)

        this.parent.add(this.mesh)
    }

    destroy()
    {
        this.parent.remove(this.mesh)

        this.mesh.dispose()
        this.geometry.dispose()
        this.material.dispose()

        for(const texture of this.textures)
            texture.dispose()
    }
}
