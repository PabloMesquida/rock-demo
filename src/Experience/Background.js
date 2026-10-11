import * as THREE from 'three/webgpu'
import { uniform, uv, vec2, float, length, clamp, smoothstep, mix, pow } from 'three/tsl'
import Experience from './Experience.js'

/**
 * Dark studio backdrop: a wide, soft radial gradient computed per pixel as a
 * TSL node and composited by PostProcessing.js behind the scene (after tone
 * mapping, in display/sRGB space, so these colours are exactly what you see).
 *
 * It is independent from the environment map that lights the rock
 * (World/Environment.js): the camera sees this, the rock reflects that.
 *
 * Being part of the render pipeline means FXAA smooths the rock silhouette
 * against the real backdrop, and the final dither removes gradient banding.
 */
export default class Background
{
    constructor()
    {
        this.experience = new Experience()
        this.sizes = this.experience.sizes
        this.debug = this.experience.debug

        this.parameters = {
            centerColor: '#161c27', // Behind the rock, slightly lighter
            edgeColor: '#0c0b0e',   // Borders and corners
            radius: 0.64,           // Relative to half the viewport diagonal
            falloff: 1.6,           // Higher = light concentrated near the centre
            centerY: 0.5            // Vertical position of the light spot
        }

        this.setUniforms()
        this.setNode()
        this.setDebug()
    }

    setUniforms()
    {
        this.uniforms = {
            centerColor: uniform(hexToVector3(this.parameters.centerColor)),
            edgeColor: uniform(hexToVector3(this.parameters.edgeColor)),
            radius: uniform(this.parameters.radius),
            falloff: uniform(this.parameters.falloff),
            centerY: uniform(this.parameters.centerY),
            aspect: uniform(this.sizes.width / this.sizes.height)
        }
    }

    setNode()
    {
        // Distance from the light spot in aspect-corrected units, normalised by
        // half the diagonal. uv() (full-screen quad) instead of screenUV because
        // the node is evaluated inside FXAA's render-to-texture.
        const scale = vec2(this.uniforms.aspect, 1)
        const offset = uv().sub(vec2(0.5, this.uniforms.centerY)).mul(scale)
        const maxDistance = length(scale).mul(0.5).mul(this.uniforms.radius)
        const t = clamp(length(offset).div(maxDistance), 0, 1)

        // Smooth falloff: 1 at the centre, 0 at the radius, no hard edge
        const strength = pow(float(1).sub(smoothstep(0, 1, t)), this.uniforms.falloff)

        /** @type {Node<vec3>} display-space (sRGB) colour */
        this.colorNode = mix(this.uniforms.edgeColor, this.uniforms.centerColor, strength)
    }

    resize()
    {
        this.uniforms.aspect.value = this.sizes.width / this.sizes.height
    }

    setDebug()
    {
        if(!this.debug.active)
            return

        const folder = this.debug.ui.addFolder('background')

        folder.addColor(this.parameters, 'centerColor').onChange((value) =>
        {
            this.uniforms.centerColor.value.copy(hexToVector3(value))
        })
        folder.addColor(this.parameters, 'edgeColor').onChange((value) =>
        {
            this.uniforms.edgeColor.value.copy(hexToVector3(value))
        })
        folder.add(this.uniforms.radius, 'value').min(0.3).max(1.5).step(0.01).name('radius')
        folder.add(this.uniforms.falloff, 'value').min(0.5).max(4).step(0.01).name('falloff')
        folder.add(this.uniforms.centerY, 'value').min(0).max(1).step(0.01).name('centerY')
    }
}

/**
 * '#rrggbb' → Vector3 in 0..1, kept in sRGB on purpose (no colour management):
 * the gradient is composited after the output colour transform.
 */
function hexToVector3(hex)
{
    const value = parseInt(hex.replace('#', ''), 16)

    return new THREE.Vector3(
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255
    )
}
