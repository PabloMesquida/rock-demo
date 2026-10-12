/**
 * Every asset the experience loads. Paths are relative to /public.
 *
 * Each GLB is self-contained: geometry + its material with the diffuse,
 * normal and occlusion textures embedded as WebP (EXT_texture_webp),
 * compressed with EXT_meshopt_compression.
 *
 * rockModel is the main rock; the others are the fragments that fall on it.
 */
export default [
    {
        name: 'rockModel',
        type: 'gltfModel',
        path: 'models/rock_00/rockDemo_00.glb'
    },
    {
        name: 'rock01Model',
        type: 'gltfModel',
        path: 'models/rock_01/rockDemo_01.glb'
    },
    {
        name: 'rock02Model',
        type: 'gltfModel',
        path: 'models/rock_02/rockDemo_02.glb'
    },
    {
        name: 'rock03Model',
        type: 'gltfModel',
        path: 'models/rock_03/rockDemo_03.glb'
    },
    {
        name: 'rock04Model',
        type: 'gltfModel',
        path: 'models/rock_04/rockDemo_04.glb'
    },
    {
        name: 'rock05Model',
        type: 'gltfModel',
        path: 'models/rock_05/rockDemo_05.glb'
    },
    {
        name: 'rock06Model',
        type: 'gltfModel',
        path: 'models/rock_06/rockDemo_06.glb'
    },
    {
        name: 'rock07Model',
        type: 'gltfModel',
        path: 'models/rock_07/rockDemo_07.glb'
    },
    {
        name: 'rock08Model',
        type: 'gltfModel',
        path: 'models/rock_08/rockDemo_08.glb'
    },
    {
        name: 'rock_s_01Model',
        type: 'gltfModel',
        path: 'models/rock_s_01/rockDemo_s_01.glb'
    },
    {
        name: 'rock_s_02Model',
        type: 'gltfModel',
        path: 'models/rock_s_02/rockDemo_s_02.glb'
    },
    {
        name: 'rock_s_03Model',
        type: 'gltfModel',
        path: 'models/rock_s_03/rockDemo_s_03.glb'
    },
    {
        name: 'rock_s_04Model',
        type: 'gltfModel',
        path: 'models/rock_s_04/rockDemo_s_04.glb'
    }
]
