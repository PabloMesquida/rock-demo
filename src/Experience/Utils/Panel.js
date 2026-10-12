import GUI from 'three/addons/libs/lil-gui.module.min.js'

/**
 * Control panel for the visitor: the few parameters worth playing with and a
 * button to launch the rocks again.
 *
 * Always there, except with #debug: Debug.js then shows every parameter, and
 * two panels over the same values would not stay in sync.
 *
 * It works like the debug UI: each class adds its own controls in setPanel(),
 * inside if(this.panel.active). Its looks are in style.css (.lil-gui.panel).
 */
export default class Panel
{
    constructor(active)
    {
        this.active = active

        if(this.active)
        {
            this.ui = new GUI({ title: 'Controls', width: 280 })
            this.ui.domElement.classList.add('panel')

            // Folded on small screens, where it would cover the rock
            if(window.matchMedia('(max-width: 720px)').matches)
                this.ui.close()
        }
    }

    destroy()
    {
        if(this.active)
            this.ui.destroy()
    }
}
