import * as THREE from 'three/webgpu'

import Debug from './Utils/Debug.js'
import Panel from './Utils/Panel.js'
import Sizes from './Utils/Sizes.js'
import Pointer from './Utils/Pointer.js'
import Time from './Utils/Time.js'
import Resources from './Utils/Resources.js'
import Camera from './Camera.js'
import Renderer from './Renderer.js'
import Physics from './Physics.js'
import Background from './Background.js'
import World from './World/World.js'
import sources from './sources.js'

let instance = null

/**
 * Main class. Creates everything else and propagates resize / update /
 * destroy from parent to children, in a controlled order.
 *
 * Singleton: any class can do `new Experience()` to get this same instance.
 */
export default class Experience
{
    constructor(canvas)
    {
        // Singleton
        if(instance)
        {
            return instance
        }
        instance = this

        // Options
        this.canvas = canvas

        // Setup
        this.debug = new Debug()
        this.panel = new Panel(!this.debug.active) // The visitor's panel, unless the debug one is there
        this.sizes = new Sizes()
        this.pointer = new Pointer(this.canvas)
        this.time = new Time()
        this.scene = new THREE.Scene()
        this.resources = new Resources(sources)
        this.camera = new Camera()
        this.background = new Background() // Before the renderer: the render pipeline composites it
        this.renderer = new Renderer()
        this.physics = new Physics()

        // Console access (window.experience) only while debugging
        if(this.debug.active)
        {
            window.experience = this
        }

        // Resize event
        this.sizes.on('resize', () =>
        {
            this.resize()
        })

        this.init()
    }

    /**
     * WebGPURenderer must finish its async init() before anything is rendered
     * or before PMREMGenerator can be used, and Rapier has to load its WASM
     * before any body is created, so the world and the loop start here.
     */
    async init()
    {
        try
        {
            await Promise.all([ this.renderer.init(), this.physics.init() ])
        }
        catch(error)
        {
            console.error('Experience: the renderer or the physics could not be initialised', error)
            return
        }

        if(this.isDestroyed)
            return

        this.world = new World()

        // Time tick event
        this.time.on('tick', () =>
        {
            this.update()
        })
        this.time.start()
    }

    resize()
    {
        this.camera.resize()
        this.background.resize()
        this.renderer.resize()
    }

    update()
    {
        this.camera.update()
        this.physics.update()
        this.world.update()
        this.renderer.update()
    }

    destroy()
    {
        this.isDestroyed = true

        this.sizes.destroy()
        this.pointer.destroy()
        this.time.destroy()

        if(this.world)
            this.world.destroy()

        this.physics.destroy()
        this.resources.destroy()
        this.camera.destroy()
        this.renderer.destroy()
        this.debug.destroy()
        this.panel.destroy()

        if(window.experience === this)
            delete window.experience

        instance = null
    }
}
