import EventEmitter from './EventEmitter.js'

/**
 * Frame clock. Values are in SECONDS (unlike the course, which uses ms) so
 * that animation speeds can be written as "units per second".
 *
 * The loop does not start on construction: WebGPURenderer needs an async
 * init() before the first render, so the Experience calls start() once the
 * renderer is ready.
 *
 * Triggers: 'tick'
 */
export default class Time extends EventEmitter
{
    constructor()
    {
        super()

        // Setup
        this.elapsed = 0
        this.delta = 1 / 60
        this.maxDelta = 1 / 10 // Avoid big jumps after the tab was in background

        this.isRunning = false
        this.frameId = null
    }

    start()
    {
        if(this.isRunning)
            return

        this.isRunning = true
        this.current = performance.now()

        this.frameId = window.requestAnimationFrame((timestamp) =>
        {
            this.tick(timestamp)
        })
    }

    tick(timestamp)
    {
        this.delta = Math.min((timestamp - this.current) / 1000, this.maxDelta)
        this.delta = Math.max(this.delta, 0)
        this.current = timestamp
        this.elapsed += this.delta

        this.trigger('tick')

        if(!this.isRunning)
            return

        this.frameId = window.requestAnimationFrame((timestamp) =>
        {
            this.tick(timestamp)
        })
    }

    stop()
    {
        this.isRunning = false

        if(this.frameId !== null)
            window.cancelAnimationFrame(this.frameId)

        this.frameId = null
    }

    destroy()
    {
        this.stop()
        this.off('tick')
    }
}
