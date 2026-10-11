import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import EventEmitter from './EventEmitter.js'

/**
 * Centralised asset loading. Receives the list from sources.js, loads every
 * entry with the matching loader and triggers 'ready' once all are loaded.
 *
 * Triggers: 'progress' (loaded, toLoad), 'ready', 'error' (source, error)
 */
export default class Resources extends EventEmitter
{
    constructor(sources)
    {
        super()

        // Options
        this.sources = sources

        // Setup
        this.items = {}
        this.toLoad = this.sources.length
        this.loaded = 0
        this.isReady = false

        this.setLoaders()
        this.startLoading()
    }

    setLoaders()
    {
        this.loaders = {}

        // rockDemo_00.glb requires EXT_meshopt_compression
        this.loaders.gltfLoader = new GLTFLoader()
        this.loaders.gltfLoader.setMeshoptDecoder(MeshoptDecoder)

        this.loaders.textureLoader = new THREE.TextureLoader()
    }

    startLoading()
    {
        for(const source of this.sources)
        {
            const loader = this.getLoader(source.type)

            if(!loader)
            {
                console.error(`Resources: unknown source type "${source.type}"`, source)
                continue
            }

            loader.load(
                source.path,
                (file) =>
                {
                    this.sourceLoaded(source, file)
                },
                undefined,
                (error) =>
                {
                    console.error(`Resources: failed to load "${source.name}" (${source.path})`, error)
                    this.trigger('error', [ source, error ])
                }
            )
        }
    }

    getLoader(type)
    {
        if(type === 'gltfModel')
            return this.loaders.gltfLoader

        if(type === 'texture')
            return this.loaders.textureLoader

        return null
    }

    sourceLoaded(source, file)
    {
        this.items[ source.name ] = file
        this.loaded++

        this.trigger('progress', [ this.loaded, this.toLoad ])

        if(this.loaded === this.toLoad)
        {
            this.isReady = true
            this.trigger('ready')
        }
    }

    /**
     * Calls the callback once every resource is loaded, even if that already
     * happened (avoids missing the 'ready' event when subscribing late).
     */
    whenReady(callback)
    {
        if(this.isReady)
            callback()
        else
            this.on('ready', callback)
    }

    destroy()
    {
        this.off('ready')
        this.off('progress')
        this.off('error')
    }
}
