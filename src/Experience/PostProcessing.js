import * as THREE from 'three/webgpu'
import { pass, renderOutput, vec4, float, step, screenCoordinate, interleavedGradientNoise } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import Experience from './Experience.js'

/**
 * RenderPipeline (r183+ name of the former PostProcessing class), following
 * "11 — TSL - Post-processing":
 *
 *   scene pass ─► + bloom ─► renderOutput (tone mapping + sRGB)
 *              ─► composite over the backdrop (depth mask) ─► FXAA ─► dither ─► canvas
 *
 * - The colour transform is applied manually (outputColorTransform = false)
 *   so FXAA works on the image the user actually sees.
 * - MSAA is disabled on the renderer: FXAA handles the anti-aliasing.
 * - No resize needed: the pipeline follows the renderer size.
 */
export default class PostProcessing
{
    constructor(renderer)
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.camera = this.experience.camera
        this.background = this.experience.background
        this.debug = this.experience.debug

        this.renderer = renderer

        this.parameters = {
            bloomStrength: 0.3,
            bloomRadius: 0.02,
            bloomThreshold: 0.015 // Scene luminance: median ≈ 0.02, max ≈ 0.2 (linear, pre tone mapping)
        }

        this.setInstance()
        this.setDebug()
    }

    setInstance()
    {
        this.instance = new THREE.RenderPipeline(this.renderer)
        this.instance.outputColorTransform = false

        // Scene pass (linear HDR)
        this.scenePass = pass(this.scene, this.camera.instance)
        const sceneColor = this.scenePass.getTextureNode('output')

        // Coverage mask from depth: 1 where the rock is drawn, 0 on the empty
        // background (cleared depth = 1). Alpha is not used for this because
        // the clear alpha is not reliable once the pass is rendered from inside
        // FXAA's render-to-texture.
        const sceneDepth = this.scenePass.getTextureNode('depth')
        const coverage = step(sceneDepth, float(0.999999))

        // Bloom (added in linear space, before tone mapping)
        this.bloomPass = bloom(
            sceneColor,
            this.parameters.bloomStrength,
            this.parameters.bloomRadius,
            this.parameters.bloomThreshold
        )
        const lit = sceneColor.rgb.add(this.bloomPass.rgb)

        // Colour transform: tone mapping + sRGB (uses the renderer settings).
        // Alpha forced to 1: renderOutput un/premultiplies by alpha, which
        // would erase the bloom halo where the scene is empty.
        const display = renderOutput(vec4(lit, 1))

        // Backdrop behind the scene; the bloom halo stays on top of it
        const composed = vec4(
            display.rgb.add(this.background.colorNode.mul(coverage.oneMinus())),
            1
        )

        // FXAA on the final, display-space image
        this.fxaaPass = fxaa(composed)

        // ±0.5 / 255 dither to avoid banding in the dark gradient
        const dither = interleavedGradientNoise(screenCoordinate.xy).sub(0.5).div(255)

        this.instance.outputNode = vec4(this.fxaaPass.rgb.add(dither), 1)
    }

    setDebug()
    {
        if(!this.debug.active)
            return

        const folder = this.debug.ui.addFolder('post-processing')
        folder.add(this.bloomPass.strength, 'value').min(0).max(2).step(0.001).name('bloom strength')
        folder.add(this.bloomPass.radius, 'value').min(0).max(1).step(0.001).name('bloom radius')
        folder.add(this.bloomPass.threshold, 'value').min(0).max(2).step(0.001).name('bloom threshold')
    }

    render()
    {
        this.instance.render()
    }

    destroy()
    {
        this.bloomPass.dispose()
        this.fxaaPass.dispose()
        this.scenePass.dispose()
        this.instance.dispose()
    }
}
