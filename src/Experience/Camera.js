import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import Experience from './Experience.js'

/**
 * Perspective camera + OrbitControls.
 *
 * frame(subject) fits the camera to the real dimensions of an object that
 * spins around the Y axis (half height + horizontal radius around the axis),
 * so the framing holds for every angle of the rotation. The fit is recomputed
 * on resize, keeping the user's orbit direction and zoom ratio.
 */
export default class Camera
{
    constructor()
    {
        this.experience = new Experience()
        this.sizes = this.experience.sizes
        this.scene = this.experience.scene
        this.canvas = this.experience.canvas
        this.debug = this.experience.debug

        this.framing = {
            subject: null,
            fill: 0.5,       // Fraction of the viewport height the subject occupies (landscape)
            fillWidth: 0.62, // Fraction of the viewport width (portrait / narrow windows)
            elevation: 0.12, // Radians above the horizon for the initial view
            zoom: 1,         // Current distance / fit distance (changes with the mouse wheel)
            fitDistance: 1
        }

        this.setInstance()
        this.setControls()
        this.setDebug()
    }

    setInstance()
    {
        this.instance = new THREE.PerspectiveCamera(30, this.sizes.width / this.sizes.height, 0.05, 50)
        this.instance.position.set(0, 0.4, 4)
        this.scene.add(this.instance)
    }

    setControls()
    {
        this.controls = new OrbitControls(this.instance, this.canvas)
        this.controls.target.set(0, 0, 0)
        this.controls.enableDamping = true
        this.controls.dampingFactor = 0.06
        this.controls.enablePan = false
        this.controls.rotateSpeed = 0.5
        this.controls.zoomSpeed = 0.6
        this.controls.minPolarAngle = Math.PI * 0.2
        this.controls.maxPolarAngle = Math.PI * 0.7
    }

    /**
     * @param {{ halfHeight: number, radius: number }} subject
     * Dimensions of the object, centred on the world origin.
     */
    frame(subject)
    {
        this.framing.subject = subject
        this.framing.zoom = 1

        this.applyFraming(this.getDefaultDirection())
    }

    getDefaultDirection()
    {
        return new THREE.Vector3(0, Math.sin(this.framing.elevation), Math.cos(this.framing.elevation))
    }

    getFitDistance()
    {
        const { halfHeight, radius } = this.framing.subject

        const verticalFov = THREE.MathUtils.degToRad(this.instance.fov)
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.instance.aspect)

        // Distance (from the nearest side of the object) so that each dimension fits
        const distanceForHeight = halfHeight / Math.tan(verticalFov / 2)
        const distanceForWidth = radius / Math.tan(horizontalFov / 2)

        return Math.max(distanceForHeight / this.framing.fill, distanceForWidth / this.framing.fillWidth) + radius
    }

    /**
     * Distance from the target, along a world direction, at which a point
     * leaves the screen by its side or by its top/bottom. Infinity when it
     * never does (directions that go away from the camera).
     */
    getExitDistance(direction)
    {
        this.instance.updateMatrixWorld()

        const right = new THREE.Vector3().setFromMatrixColumn(this.instance.matrixWorld, 0)
        const up = new THREE.Vector3().setFromMatrixColumn(this.instance.matrixWorld, 1)
        const toCamera = new THREE.Vector3().setFromMatrixColumn(this.instance.matrixWorld, 2)
        const distance = this.instance.position.distanceTo(this.controls.target)
        const tanVertical = Math.tan(THREE.MathUtils.degToRad(this.instance.fov) / 2)
        const tanHorizontal = tanVertical * this.instance.aspect

        // The screen narrows towards the camera and widens away from it
        const towardsCamera = direction.dot(toCamera)
        const horizontal = Math.abs(direction.dot(right)) + towardsCamera * tanHorizontal
        const vertical = Math.abs(direction.dot(up)) + towardsCamera * tanVertical

        return Math.min(
            horizontal > 1e-3 ? (distance * tanHorizontal) / horizontal : Infinity,
            vertical > 1e-3 ? (distance * tanVertical) / vertical : Infinity
        )
    }

    applyFraming(direction)
    {
        const fitDistance = this.getFitDistance()
        this.framing.fitDistance = fitDistance

        const distance = fitDistance * this.framing.zoom
        this.instance.position.copy(this.controls.target).addScaledVector(direction.normalize(), distance)

        this.instance.near = Math.max(0.01, fitDistance * 0.05)
        this.instance.far = fitDistance * 10
        this.instance.updateProjectionMatrix()

        this.controls.minDistance = fitDistance * 0.55
        this.controls.maxDistance = fitDistance * 1.8
        this.controls.update()
    }

    resize()
    {
        // Remember the user's zoom ratio relative to the previous fit
        if(this.framing.subject)
        {
            const currentDistance = this.instance.position.distanceTo(this.controls.target)
            const zoom = currentDistance / this.framing.fitDistance
            this.framing.zoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
        }

        this.instance.aspect = this.sizes.width / this.sizes.height
        this.instance.updateProjectionMatrix()

        if(this.framing.subject)
        {
            let direction = this.instance.position.clone().sub(this.controls.target)

            if(!Number.isFinite(direction.lengthSq()) || direction.lengthSq() === 0)
                direction = this.getDefaultDirection()

            this.applyFraming(direction)
        }
    }

    setDebug()
    {
        if(!this.debug.active)
            return

        const folder = this.debug.ui.addFolder('camera')
        const refit = () =>
        {
            if(this.framing.subject)
                this.applyFraming(this.instance.position.clone().sub(this.controls.target))
        }

        folder.add(this.framing, 'fill').min(0.3).max(0.95).step(0.01).name('fill height').onChange(refit)
        folder.add(this.framing, 'fillWidth').min(0.3).max(0.95).step(0.01).name('fill width').onChange(refit)
    }

    update()
    {
        this.controls.update()
    }

    destroy()
    {
        this.controls.dispose()
    }
}
