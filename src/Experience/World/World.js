import Experience from '../Experience.js'
import Rock from './Rock.js'
import Environment from './Environment.js'

/**
 * Everything that lives in the 3D scene. Waits for the resources, then
 * creates the rock and the environment (lights + environment map).
 *
 * Future stages (physics, instances, TSL experiments) are meant to be added
 * here as new World/ classes, updated from update().
 */
export default class World
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources
        this.camera = this.experience.camera
        this.renderer = this.experience.renderer

        this.resources.whenReady(() =>
        {
            this.setup()
        })
    }

    async setup()
    {
        this.rock = new Rock()
        this.environment = new Environment()

        this.camera.frame(this.rock.dimensions)

        // Compile the pipelines before showing the canvas to avoid a first-frame hitch
        await this.renderer.instance.compileAsync(this.scene, this.camera.instance)

        this.experience.canvas.classList.add('is-ready')
    }

    update()
    {
        if(this.rock)
            this.rock.update()
    }

    destroy()
    {
        if(this.rock)
            this.rock.destroy()

        if(this.environment)
            this.environment.destroy()
    }
}
