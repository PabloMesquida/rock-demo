/**
 * Every asset the experience loads. Paths are relative to /public.
 *
 * rockDemo_00.glb is self-contained: geometry + the "Rock" material with its
 * diffuse, normal and occlusion textures embedded as WebP (EXT_texture_webp),
 * compressed with EXT_meshopt_compression.
 */
export default [
    {
        name: 'rockModel',
        type: 'gltfModel',
        path: 'models/rock_00/rockDemo_00.glb'
    }
]
