import GUI from 'three/addons/libs/lil-gui.module.min.js'

/**
 * Debug UI, only active when the URL ends with #debug.
 * lil-gui is the copy bundled inside three (no extra dependency).
 */
export default class Debug
{
    constructor()
    {
        this.active = window.location.hash === '#debug'

        if(this.active)
        {
            this.ui = new GUI({ title: 'rock demo' })
        }
    }

    destroy()
    {
        if(this.active)
            this.ui.destroy()
    }
}
