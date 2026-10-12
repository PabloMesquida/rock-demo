import Experience from '../Experience.js'
import Rock from './Rock.js'
import Environment from './Environment.js'
import Fragments from './Fragments.js'
import Orbiters from './Orbiters.js'

/**
 * Everything that lives in the 3D scene. Waits for the resources, then
 * creates the rock, the environment (lights + environment map), the
 * fragments that fall on the rock and the small rocks that orbit it.
 *
 * Future stages (instances, TSL experiments) are meant to be added here as
 * new World/ classes, updated from update().
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
        this.panel = this.experience.panel

        this.resources.whenReady(() =>
        {
            this.setup()
        })
    }

    async setup()
    {
        this.rock = new Rock()
        this.environment = new Environment()

        this.fragments = new Fragments(this.rock)
        this.orbiters = new Orbiters(this.fragments)

        this.setPanel()

        this.camera.frame(this.rock.dimensions)

        // Compile the pipelines before showing the canvas to avoid a first-frame hitch
        await this.renderer.instance.compileAsync(this.scene, this.camera.instance)

        this.experience.canvas.classList.add('is-ready')
    }

    /**
     * Last in the visitor's panel, after the controls each class added.
     */
    setPanel()
    {
        if(!this.panel.active)
            return

        this.panel.ui.add(this, 'launch').name('Launch').domElement.classList.add('launch')
    }

    /**
     * Plays the whole sequence again: the fragments fall, and the orbiters
     * leave to come back once they have settled.
     */
    launch()
    {
        this.fragments.launch()
        this.orbiters.reset()
    }

    update()
    {
        if(this.rock)
            this.rock.update()

        if(this.fragments)
            this.fragments.update()

        if(this.orbiters)
            this.orbiters.update()
    }

    destroy()
    {
        if(this.orbiters)
            this.orbiters.destroy()

        if(this.fragments)
            this.fragments.destroy()

        if(this.rock)
            this.rock.destroy()

        if(this.environment)
            this.environment.destroy()
    }
}
