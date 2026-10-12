import * as THREE from 'three/webgpu'
import RAPIER from '@dimforge/rapier3d-compat'
import Experience from '../Experience.js'
import RockInstances from './RockInstances.js'

const _position = new THREE.Vector3()
const _velocity = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()
const _matrix = new THREE.Matrix4()

/**
 * Small rocks that come close to the main rock and stay orbiting around it.
 *
 * Each one has an ideal orbit: an ellipse with the main rock at one focus. The
 * approach is the same ellipse scaled up, shrinking to its real size while the
 * rock moves along it, which draws a spiral from outside the screen.
 *
 * They are Rapier bodies with a convex hull, driven along that orbit by their
 * velocity. When something gets in the way (another orbiter, the main rock, a
 * fragment) the collision pushes them off it, and they drift back. Nothing
 * pulls them towards the rock and they never stick.
 *
 * The orbits are fixed in world space (they neither spin nor sway with the
 * rock), but the bodies live in the physics world, which is the space of the
 * rock pivot. update() converts between both on every frame.
 *
 * They are launched once every fragment is stuck, and the orbits leave a gap
 * around the rock plus whatever got stuck to it.
 *
 * Receives the fragments by parameter because World is still being built when
 * this is created (experience.world may not exist yet).
 */
export default class Orbiters
{
    constructor(fragments)
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.time = this.experience.time
        this.camera = this.experience.camera
        this.physics = this.experience.physics
        this.debug = this.experience.debug
        this.panel = this.experience.panel

        this.fragments = fragments
        this.pivot = fragments.rock.pivot

        this.parameters = {
            delay: 0.5,         // Seconds between the last fragment getting stuck and the launch
            gap: 0.03,          // Closest any orbit gets to the rock and what is stuck to it
            band: 0.63,         // Width of the zone, beyond the gap, where the orbits are spread
            eccentricity: 0.02, // Maximum; 0 = circles
            tilt: 0.55,         // Maximum inclination of the orbits (radians from horizontal)
            speed: 0.74,        // Angular speed (rad/s) of a circular orbit of radius 1; wider orbits are slower
            approachTime: 2.5,  // Time constant of the spiral: ~95 % of the way after three times this
            spawnMargin: 2,     // How far beyond the edge of the screen they start
            spawnMax: 12,       // Furthest start, for the ones that can't start off screen
            appearTime: 1,      // Seconds they take to grow to full size
            spin: 1.5,          // Maximum tumbling speed at launch (rad/s)
            recover: 1.5        // How fast they go back to their orbit after being pushed off it (per second)
        }

        // One entry per model; "count" instances of each
        this.types = [
            { resource: 'rock_s_01Model', count: 1 },
            { resource: 'rock_s_02Model', count: 1 },
            { resource: 'rock_s_03Model', count: 1 },
            { resource: 'rock_s_04Model', count: 1 }
        ]

        this.isLaunched = false
        this.wait = 0
        this.reach = 0 // Radius the orbits stay out of, measured at launch

        // Pivot space of the frame in which the bodies were last driven
        this.frame = new THREE.Matrix4()

        this.setItems()
        this.setDebug()
        this.setPanel()
    }

    /**
     * One instance and one rigid body per rock, disabled until launch().
     */
    setItems()
    {
        const world = this.physics.instance

        this.items = []

        for(const type of this.types)
        {
            // Meshes in world space: update() places them from the bodies
            type.instances = new RockInstances(type.resource, type.count, this.scene)

            const colliderDesc = type.instances.createColliderDesc()

            for(let index = 0; index < type.count; index++)
            {
                const body = world.createRigidBody(
                    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1000, 0).setEnabled(false)
                )

                world.createCollider(colliderDesc, body)

                this.items.push({
                    type,
                    index,
                    body,
                    semiMajorAxis: 1,
                    eccentricity: 0,
                    lane: 0,                        // Its place across the band, 0 = innermost
                    periapsis: new THREE.Vector3(), // Direction of the closest point of the orbit
                    sideways: new THREE.Vector3(),  // Perpendicular to it, in the plane of the orbit
                    angle: 0,                       // Position along the orbit, from the periapsis
                    approach: 1,                    // Size of the ellipse at launch, relative to the real one
                    age: 0,
                    target: new THREE.Vector3(),    // Point of the orbit it was last sent to, in pivot space
                    offset: new THREE.Vector3()     // How far collisions have pushed it from the orbit
                })
            }
        }
    }

    /**
     * Gives every rock its orbit and puts it at the start of its spiral.
     * Called once the fragments are settled; the debug UI can repeat it.
     */
    launch()
    {
        const camera = this.camera.instance
        const { eccentricity, tilt, spawnMargin, spawnMax, spin } = this.parameters

        camera.updateMatrixWorld()
        this.pivot.updateMatrixWorld()
        this.frame.copy(this.pivot.matrixWorld)
        this.reach = this.fragments.getReach()

        const toCamera = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2)
        const normal = new THREE.Vector3()
        const direction = new THREE.Vector3()

        this.items.forEach((item, i) =>
        {
            // Each one in its own lane
            item.lane = (i + Math.random()) / this.items.length
            item.eccentricity = Math.random() * eccentricity
            item.semiMajorAxis = this.getSemiMajorAxis(item)

            // Plane of the orbit: horizontal, tilted a little in any direction.
            // Turning from "periapsis" to "sideways" goes the way the rock spins
            direction.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * Math.PI * 2)
            normal.copy(THREE.Object3D.DEFAULT_UP).applyAxisAngle(direction, Math.random() * tilt)

            item.periapsis.crossVectors(normal, direction.randomDirection()).normalize()
            item.sideways.crossVectors(normal, item.periapsis)

            // Start anywhere on the orbit, except in front of the camera:
            // the spiral would come through the lens
            for(let attempt = 0; attempt < 16; attempt++)
            {
                item.angle = Math.random() * Math.PI * 2
                direction.copy(item.periapsis).multiplyScalar(Math.cos(item.angle)).addScaledVector(item.sideways, Math.sin(item.angle))

                if(direction.dot(toCamera) < 0.3)
                    break
            }

            // As close as it can be while still off screen
            const start = Math.min(this.camera.getExitDistance(direction) + spawnMargin, spawnMax)

            item.approach = Math.max(1, start / this.getDistance(item))
            item.age = 0
            item.offset.set(0, 0, 0)

            // Body at the start of the spiral, tumbling
            this.pivot.worldToLocal(this.getOrbitPosition(item, item.target))

            item.body.setEnabled(true)
            item.body.setTranslation(item.target, true)
            item.body.setRotation(_quaternion.random(), true)
            item.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
            item.body.setAngvel(direction.randomDirection().multiplyScalar(spin * (0.4 + Math.random() * 0.6)), true)
        })

        this.isLaunched = true
    }

    /**
     * Size of the orbit that puts its closest point just outside the rock:
     * past the gap, in the lane of the item.
     */
    getSemiMajorAxis(item)
    {
        const closest = this.reach + this.parameters.gap + item.type.instances.radius + this.parameters.band * item.lane

        return closest / (1 - item.eccentricity)
    }

    /**
     * Applies the gap and the band to the orbits that are already running.
     * The rocks drift to their new lane like after a collision.
     */
    setLanes()
    {
        if(!this.isLaunched)
            return

        for(const item of this.items)
            item.semiMajorAxis = this.getSemiMajorAxis(item)
    }

    /**
     * Takes the rocks away until the fragments settle again.
     */
    reset()
    {
        for(const item of this.items)
        {
            item.body.setEnabled(false)
            item.type.instances.park(item.index)
        }

        this.isLaunched = false
        this.wait = 0
    }

    /**
     * Distance to the centre at the current angle of the orbit.
     */
    getDistance(item)
    {
        return item.semiMajorAxis * (1 - item.eccentricity ** 2) / (1 + item.eccentricity * Math.cos(item.angle))
    }

    /**
     * How much bigger than the real orbit the ellipse still is: starts at
     * item.approach and shrinks to 1.
     */
    getSize(item)
    {
        return 1 + (item.approach - 1) * Math.exp(- item.age / this.parameters.approachTime)
    }

    /**
     * Point of the orbit where the rock should be now, in world space.
     */
    getOrbitPosition(item, target)
    {
        return target
            .copy(item.periapsis).multiplyScalar(Math.cos(item.angle))
            .addScaledVector(item.sideways, Math.sin(item.angle))
            .multiplyScalar(this.getDistance(item) * this.getSize(item))
    }

    setDebug()
    {
        if(!this.debug.active)
            return

        const folder = this.debug.ui.addFolder('orbiters')

        folder.add(this.parameters, 'speed').min(0).max(5).step(0.01)
        folder.add(this.parameters, 'recover').min(0).max(10).step(0.01)
        folder.add(this.parameters, 'approachTime').min(0.1).max(10).step(0.01).name('approach time')
        folder.add(this.parameters, 'appearTime').min(0).max(6).step(0.01).name('appear time')
        folder.add(this.parameters, 'gap').min(0).max(2).step(0.01).onChange(() => this.setLanes())
        folder.add(this.parameters, 'band').min(0).max(3).step(0.01).onChange(() => this.setLanes())
        folder.add(this.parameters, 'eccentricity').min(0).max(0.6).step(0.01).name('eccentricity (next launch)')
        folder.add(this.parameters, 'tilt').min(0).max(1.5).step(0.01).name('tilt (next launch)')
        folder.add(this.parameters, 'spin').min(0).max(6).step(0.01).name('spin (next launch)')
        folder.add(this.parameters, 'spawnMargin').min(0).max(10).step(0.1).name('spawn margin')
        folder.add(this.parameters, 'spawnMax').min(2).max(30).step(0.1).name('spawn max')
        folder.add(this, 'launch')
    }

    /**
     * What the visitor can play with. All three act on the running orbits.
     */
    setPanel()
    {
        if(!this.panel.active)
            return

        const folder = this.panel.ui.addFolder('Orbits')
        const setLanes = () => this.setLanes()

        folder.add(this.parameters, 'speed').min(0).max(3).step(0.01).name('Speed')
        folder.add(this.parameters, 'gap').min(0).max(1).step(0.01).name('Gap').onChange(setLanes)
        folder.add(this.parameters, 'band').min(0).max(2).step(0.01).name('Band').onChange(setLanes)
    }

    /**
     * Runs after the physics step of the frame (see Experience.update()).
     */
    update()
    {
        const delta = this.time.delta

        if(!this.isLaunched)
        {
            // Wait for the fragments, then a little more
            this.wait = this.fragments.isSettled ? this.wait + delta : 0

            if(this.wait < this.parameters.delay)
                return

            this.launch()
        }

        const { speed, appearTime, recover } = this.parameters
        const step = this.physics.instance.timestep
        const keep = Math.exp(- recover * delta)

        this.pivot.updateMatrixWorld()

        for(const item of this.items)
        {
            item.age += delta

            // Where the step left it. Anything other than where it was sent
            // is the work of a collision
            _position.copy(item.body.translation())
            item.offset.copy(_position).sub(item.target)

            // Mesh in world space. The body was driven in the pivot space of
            // the previous frame, so that is the one that takes it back
            _scale.setScalar(THREE.MathUtils.smoothstep(item.age, 0, appearTime))
            _matrix.compose(_position, _quaternion.copy(item.body.rotation()), _scale).premultiply(this.frame)

            item.type.instances.mesh.setMatrixAt(item.index, _matrix)
            item.type.instances.mesh.instanceMatrix.needsUpdate = true

            // Advance along the orbit. Kepler: the closer to the centre, the
            // faster it turns
            const size = this.getSize(item)
            const shape = item.semiMajorAxis * (1 - item.eccentricity ** 2)
            const distance = this.getDistance(item) * size

            item.angle += (speed * Math.sqrt(shape * size) / (distance * distance)) * delta

            // Velocity that takes it, in the next step, to its new point of the
            // orbit plus what is left of the push: that part fades away
            this.pivot.worldToLocal(this.getOrbitPosition(item, item.target))

            _velocity.copy(item.target).addScaledVector(item.offset, keep).sub(_position).divideScalar(step)
            item.body.setLinvel(_velocity, true)
        }

        this.frame.copy(this.pivot.matrixWorld)
    }

    destroy()
    {
        // The bodies are freed with the physics world
        for(const type of this.types)
            type.instances.destroy()
    }
}
