import EventEmitter from './EventEmitter.js'

/**
 * Viewport sizes. Assumes the experience fills the whole window.
 * Triggers: 'resize'
 */
export default class Sizes extends EventEmitter
{
    constructor()
    {
        super()

        this.update()

        this.onResize = () =>
        {
            this.update()
            this.trigger('resize')
        }

        window.addEventListener('resize', this.onResize)
    }

    update()
    {
        // Never 0: a page opened in a hidden tab/pane can report 0 × 0,
        // which would turn the camera aspect (and everything after it) into NaN
        this.width = Math.max(1, window.innerWidth)
        this.height = Math.max(1, window.innerHeight)
        this.pixelRatio = Math.min(window.devicePixelRatio, 2)
    }

    destroy()
    {
        window.removeEventListener('resize', this.onResize)
        this.off('resize')
    }
}
