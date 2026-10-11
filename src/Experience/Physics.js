import RAPIER from '@dimforge/rapier3d-compat'
import Experience from './Experience.js'

/**
 * Rapier world, stepped once per frame.
 *
 * There is no global gravity: World/Fragments.js pulls its own bodies towards
 * the main rock. Every body is expressed in the space of the rock pivot, where
 * the main rock doesn't move (see World/Rock.js).
 *
 * Rapier is a WASM module and needs an async init() before anything is
 * created, so the Experience waits for it together with the renderer.
 */
export default class Physics
{
    constructor()
    {
        this.experience = new Experience()
        this.time = this.experience.time
    }

    async init()
    {
        await RAPIER.init()

        this.instance = new RAPIER.World({ x: 0, y: 0, z: 0 })
    }

    update()
    {
        // Clamped: a long frame must not blast the bodies through each other
        this.instance.timestep = Math.min(this.time.delta, 1 / 30)
        this.instance.step()
    }

    destroy()
    {
        // Frees every body and collider with it
        if(this.instance)
            this.instance.free()
    }
}
