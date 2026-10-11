import * as THREE from 'three/webgpu'
import Experience from './Experience.js'
import PostProcessing from './PostProcessing.js'

/**
 * WebGPURenderer (three r186). Uses WebGPU when available and falls back to
 * its WebGL 2 backend automatically otherwise.
 *
 * Frames are produced by PostProcessing.js (RenderPipeline): bloom, colour
 * transform, backdrop composite and FXAA. MSAA is off because FXAA replaces it.
 */
export default class Renderer
{
    constructor()
    {
        this.experience = new Experience()
        this.canvas = this.experience.canvas
        this.sizes = this.experience.sizes
        this.scene = this.experience.scene
        this.camera = this.experience.camera
        this.debug = this.experience.debug

        this.setInstance()
        this.setDebug()
        this.setPostProcessing()
    }

    setInstance()
    {
        this.instance = new THREE.WebGPURenderer({
            canvas: this.canvas,
            antialias: false, // FXAA in PostProcessing.js
            alpha: true
        })

        this.instance.setClearColor(0x000000, 0)
        this.instance.toneMapping = THREE.ACESFilmicToneMapping
        this.instance.toneMappingExposure = 1.15
        this.instance.setSize(this.sizes.width, this.sizes.height)
        this.instance.setPixelRatio(this.sizes.pixelRatio)
    }

    setDebug()
    {
        if(!this.debug.active)
            return

        const folder = this.debug.ui.addFolder('renderer')
        folder.add(this.instance, 'toneMappingExposure').min(0.2).max(3).step(0.01).name('exposure')
    }

    setPostProcessing()
    {
        this.postProcessing = new PostProcessing(this.instance)
    }

    async init()
    {
        await this.instance.init()

        const backendName = this.instance.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)'

        console.info(`Renderer: three r${THREE.REVISION} · backend ${backendName}`)
    }

    resize()
    {
        this.instance.setSize(this.sizes.width, this.sizes.height)
        this.instance.setPixelRatio(this.sizes.pixelRatio)
    }

    update()
    {
        this.postProcessing.render()
    }

    destroy()
    {
        this.postProcessing.destroy()
        this.instance.dispose()
    }
}
