import * as THREE from 'three/webgpu'

const _scale = new THREE.Vector3(1, 1, 1)
const _vector = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()

/**
 * A small displacement that always goes back to rest: something pushes an
 * object a little off its place and a damped spring brings it back, both for
 * its position and for its orientation.
 *
 * It only holds the numbers. Rock.js applies one to its pivot, and
 * Fragments.js one to every fragment stuck to the rock.
 */
export default class Sway
{
    constructor()
    {
        this.offset = new THREE.Vector3()
        this.offsetVelocity = new THREE.Vector3()
        this.tilt = new THREE.Vector3() // Rotation vector: direction = axis, length = angle
        this.tiltVelocity = new THREE.Vector3()
    }

    /**
     * @param {THREE.Vector3} point    Where it is pushed, relative to its centre
     * @param {THREE.Vector3} velocity What pushes it
     * @param {number} linear          How much of it becomes movement
     * @param {number} angular         How much of it becomes tipping
     */
    push(point, velocity, linear, angular)
    {
        this.offsetVelocity.addScaledVector(velocity, linear)
        this.tiltVelocity.addScaledVector(_vector.crossVectors(point, velocity), angular)
    }

    /**
     * @param {number} delta
     * @param {number} frequency Swings per second
     * @param {number} damping   0 = swings forever, 1 = goes back without overshooting
     */
    update(delta, frequency, damping)
    {
        const angular = frequency * Math.PI * 2
        const stiffness = angular * angular
        const friction = damping * angular * 2

        this.offsetVelocity.addScaledVector(this.offset, - stiffness * delta).addScaledVector(this.offsetVelocity, - friction * delta)
        this.offset.addScaledVector(this.offsetVelocity, delta)

        this.tiltVelocity.addScaledVector(this.tilt, - stiffness * delta).addScaledVector(this.tiltVelocity, - friction * delta)
        this.tilt.addScaledVector(this.tiltVelocity, delta)
    }

    /**
     * The tilt as a quaternion. "amount" scales it.
     */
    getQuaternion(target, amount = 1)
    {
        return target.setFromAxisAngle(_vector.copy(this.tilt).normalize(), this.tilt.length() * amount)
    }

    /**
     * The whole displacement as a matrix. "amount" scales it.
     */
    getMatrix(target, amount = 1)
    {
        this.getQuaternion(_quaternion, amount)

        return target.compose(_vector.copy(this.offset).multiplyScalar(amount), _quaternion, _scale)
    }

    reset()
    {
        this.offset.set(0, 0, 0)
        this.offsetVelocity.set(0, 0, 0)
        this.tilt.set(0, 0, 0)
        this.tiltVelocity.set(0, 0, 0)
    }
}
