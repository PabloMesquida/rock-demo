import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

/**
 * Night lighting for the rock.
 *
 * - Key light: soft, cool-neutral, coming from the upper left at a fairly
 *   grazing angle so the normal map produces visible light/shadow variation.
 * - Rim light: subtle, from behind on the right, separates the silhouette
 *   from the dark backdrop.
 * - Environment map: a tiny procedural "night studio" (dark room + two dim
 *   softboxes) baked with PMREMGenerator. It only lights/reflects on the rock;
 *   the camera never sees it (the backdrop is Background.js).
 */
export default class Environment
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.renderer = this.experience.renderer
        this.debug = this.experience.debug

        this.setKeyLight()
        this.setRimLight()
        this.setEnvironmentMap()
        this.setDebug()
    }

    setKeyLight()
    {
        this.keyLight = new THREE.DirectionalLight('#dfe5ee', 2.278)
        this.keyLight.position.set(- 2.6, 1.9, 1.074)
        this.scene.add(this.keyLight)
    }

    setRimLight()
    {
        this.rimLight = new THREE.DirectionalLight('#a9b8d3', 1.885)
        this.rimLight.position.set(2.4, 1.4, - 2.8)
        this.scene.add(this.rimLight)
    }

    setEnvironmentMap()
    {
        this.environmentMap = {}
        this.environmentMap.intensity = 1.385

        const studio = createNightStudio()
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer.instance)

        this.environmentMap.renderTarget = pmremGenerator.fromScene(studio.scene, 0.04)
        this.environmentMap.texture = this.environmentMap.renderTarget.texture

        pmremGenerator.dispose()
        studio.dispose()

        this.scene.environment = this.environmentMap.texture
        this.scene.environmentIntensity = this.environmentMap.intensity
    }

    setDebug()
    {
        if(!this.debug.active)
            return

        this.debugFolder = this.debug.ui.addFolder('environment')

        this.addLightDebug(this.keyLight, 'key')
        this.addLightDebug(this.rimLight, 'rim')

        this.debugFolder
            .add(this.scene, 'environmentIntensity')
            .min(0)
            .max(2)
            .step(0.001)
            .name('envMapIntensity')
    }

    addLightDebug(light, name)
    {
        const folder = this.debugFolder.addFolder(`${name} light`)
        folder.add(light, 'intensity').min(0).max(10).step(0.001)
        folder.add(light.position, 'x').min(- 5).max(5).step(0.001)
        folder.add(light.position, 'y').min(- 5).max(5).step(0.001)
        folder.add(light.position, 'z').min(- 5).max(5).step(0.001)

        // Proxy in sRGB hex so the picker shows the same value as the code
        const colorParameters = { color: `#${light.color.getHexString()}` }
        folder.addColor(colorParameters, 'color').onChange((value) =>
        {
            light.color.set(value)
        })
    }

    destroy()
    {
        this.scene.remove(this.keyLight, this.rimLight)
        this.keyLight.dispose()
        this.rimLight.dispose()

        this.scene.environment = null
        this.environmentMap.renderTarget.dispose()
    }
}

/**
 * Procedural night studio used only to bake the environment map.
 * Emissive-only Lambert materials, like three's RoomEnvironment.
 */
function createNightStudio()
{
    const scene = new THREE.Scene()

    const geometry = new THREE.BoxGeometry()
    geometry.deleteAttribute('uv')

    const materials = []
    const emissive = (color, intensity) =>
    {
        const material = new THREE.MeshLambertMaterial({
            color: 0x000000,
            emissive: color,
            emissiveIntensity: intensity
        })
        materials.push(material)

        return material
    }

    // Room shell: almost black, slightly cool
    const roomMaterial = emissive('#0c0e13', 1)
    roomMaterial.side = THREE.BackSide

    const room = new THREE.Mesh(geometry, roomMaterial)
    room.scale.setScalar(24)
    scene.add(room)

    // Large soft box on the key side (upper left, front)
    const keyPanel = new THREE.Mesh(geometry, emissive('#e4e9f2', 6))
    keyPanel.position.set(- 7, 6, 5)
    keyPanel.scale.set(6, 6, 0.1)
    keyPanel.lookAt(0, 0, 0)
    scene.add(keyPanel)

    // Narrow cool strip behind on the right (rim reflections)
    const rimPanel = new THREE.Mesh(geometry, emissive('#a7b7d6', 4))
    rimPanel.position.set(7, 3, - 7)
    rimPanel.scale.set(1.2, 7, 0.1)
    rimPanel.lookAt(0, 0, 0)
    scene.add(rimPanel)

    // Faint overhead fill
    const topPanel = new THREE.Mesh(geometry, emissive('#c3ccdb', 1.2))
    topPanel.position.set(0, 10, 0)
    topPanel.scale.set(8, 0.1, 8)
    scene.add(topPanel)

    return {
        scene,
        dispose: () =>
        {
            geometry.dispose()

            for(const material of materials)
                material.dispose()
        }
    }
}
