/**
 * Pointer (mouse, pen or finger) over the canvas.
 *
 * x / y are in normalised device coordinates: -1 to 1, Y up, ready for a
 * Raycaster. isInside is false until the pointer has been seen over the
 * canvas, and again once it leaves. isDown is true while a button or a finger
 * is pressed, which is when OrbitControls is using it.
 *
 * Listens on the canvas, not on window.
 */
export default class Pointer
{
    constructor(canvas)
    {
        this.canvas = canvas

        this.x = 0
        this.y = 0
        this.isInside = false
        this.isDown = false

        this.onMove = (event) =>
        {
            const bounds = this.canvas.getBoundingClientRect()

            this.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
            this.y = - ((event.clientY - bounds.top) / bounds.height) * 2 + 1
            this.isInside = true
        }

        this.onDown = (event) =>
        {
            this.onMove(event)
            this.isDown = true
        }

        this.onUp = () =>
        {
            this.isDown = false
        }

        this.onLeave = () =>
        {
            this.isInside = false
            this.isDown = false
        }

        this.canvas.addEventListener('pointermove', this.onMove)
        this.canvas.addEventListener('pointerdown', this.onDown)
        this.canvas.addEventListener('pointerup', this.onUp)
        this.canvas.addEventListener('pointercancel', this.onLeave)
        this.canvas.addEventListener('pointerleave', this.onLeave)
    }

    destroy()
    {
        this.canvas.removeEventListener('pointermove', this.onMove)
        this.canvas.removeEventListener('pointerdown', this.onDown)
        this.canvas.removeEventListener('pointerup', this.onUp)
        this.canvas.removeEventListener('pointercancel', this.onLeave)
        this.canvas.removeEventListener('pointerleave', this.onLeave)
    }
}
