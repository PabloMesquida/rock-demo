# Rock Demo

Demo 3D en el navegador con Three.js (WebGPU) y Vite. Hoy es un visor de una roca que gira en un estudio nocturno. Va a crecer por etapas: físicas con Rapier, instancias con `InstancedMesh` y experimentos con TSL. La arquitectura tiene que permitir sumar esas etapas sin rehacer el visor.

Respondé en español.

## Comandos

```bash
npm run dev      # Vite en http://localhost:5173  (#debug para el panel lil-gui)
npm run build    # build de producción en dist/
npm run preview  # sirve dist/
```

No hay tests ni linter. Validar = `npm run build` sin errores + abrir el dev server y revisar la consola (debe decir `Renderer: three r186 · backend WebGPU` y nada más).

## Stack (no cambiar sin motivo)

- `three` 0.186.1: importar siempre desde `three/webgpu`, `three/tsl` y `three/addons/...`. Nunca desde `three` a secas en nuestro código.
- `vite` 8.3.4, sin `vite.config.js`. Los assets estáticos van en `public/`.
- Sin dependencias extra: lil-gui y el decoder de meshopt salen de `three/addons/libs/`. Antes de añadir una dependencia, preguntar.

## Arquitectura

Sigue `../Referencias/26 — Code structuring for bigger projects.pdf` (Bruno Simon / Three.js Journey):

```
src/main.js                         entrada: importa style.css e instancia Experience
src/Experience/Experience.js        singleton; crea todo y propaga resize → update → destroy
src/Experience/sources.js           lista de assets { name, type, path }
src/Experience/Camera.js            PerspectiveCamera + OrbitControls + encuadre automático (frame())
src/Experience/Renderer.js          WebGPURenderer (antialias false) + tone mapping; delega el frame a PostProcessing
src/Experience/PostProcessing.js    THREE.RenderPipeline: scene pass → bloom → renderOutput → fondo → FXAA → dither
src/Experience/Background.js        gradiente radial como nodo TSL (uniforms), en espacio de display sRGB
src/Experience/Utils/               EventEmitter, Sizes, Time, Resources, Debug
src/Experience/World/World.js       espera a Resources; crea Rock y Environment; update() de lo que vive en escena
src/Experience/World/Rock.js        modelo, anisotropy, pivot de rotación, dimensiones para el encuadre
src/Experience/World/Environment.js key + rim light y env map PMREM de un "night studio" procedural
```

Convenciones (las del PDF, respetarlas):
- Una clase por archivo, `export default class`. Estilo del PDF: llaves en línea propia (Allman), sin punto y coma, 4 espacios.
- Las clases obtienen lo que necesitan con `this.experience = new Experience()` (singleton). Excepción: `PostProcessing` recibe el renderer por parámetro porque se crea dentro del constructor de `Renderer`.
- Métodos `setX()` en el constructor (`setInstance`, `setModel`, `setDebug`…). Además `resize()`, `update()` y `destroy()` cuando hacen falta, llamados desde el padre (nunca escuchar `window` directamente salvo en `Sizes`).
- Eventos con `EventEmitter`: `sizes 'resize'`, `time 'tick'`, `resources 'ready'` (más `'progress'` y `'error'`). Para no perder un `'ready'` que ya ocurrió, usar `resources.whenReady(cb)`. Si un asset falla, `'ready'` no llega nunca y el canvas queda invisible: mirar la consola.
- `Time` mide en **segundos** (el PDF usa ms). Toda animación usa `this.time.delta`. El delta está limitado a 0.1 s.
- Debug: solo con `#debug` en la URL. Cada clase crea su carpeta (`this.debug.ui.addFolder(...)`) dentro de `if(this.debug.active)`. `window.experience` solo existe en modo debug.
- No fragmentar en archivos pequeños sin valor ni meter abstracciones especulativas.

## Cómo añadir las próximas etapas

- Nuevos objetos o sistemas de escena (Rapier, instancias, experimentos TSL): nueva clase en `World/`, creada en `World.setup()` y actualizada en `World.update()`.
- Nuevos assets: entrada en `sources.js` (tipos soportados por `Resources`: `gltfModel` y `texture`; añadir loader ahí si hace falta otro).
- Nuevos efectos de pantalla: en `PostProcessing.js`, antes de `renderOutput()` si trabajan en lineal/HDR, después si trabajan sobre la imagen final. FXAA y el dither van siempre al final.
- Referencias en `../Referencias/`: `11 — TSL - Post-processing.pdf`, `13 — TSL - Instances.pdf`, `26 — Code structuring for bigger projects.pdf`. Leer el que corresponda antes de implementar esa parte.

## Three r186 + WebGPU: trampas conocidas

- `renderer.render()`, `PMREMGenerator.fromScene()` y similares **lanzan error** antes de `await renderer.init()`. Por eso `Experience.init()` espera al renderer antes de crear `World` y arrancar `Time`.
- `PostProcessing` se renombró a **`THREE.RenderPipeline`** en r183 (el viejo es un alias deprecated). `renderAsync()` también está deprecated: usar `render()`.
- Con `outputColorTransform = false`, el tone mapping y sRGB los aplica `renderOutput()` a mano (necesario para que FXAA vea la imagen final).
- **Máscara del fondo por depth, no por alpha:** dentro del render-to-texture que crea `fxaa()`, el alpha del scene pass llega a 1. Se usa `step(depth, 0.999999)` sobre `scenePass.getTextureNode('depth')`. Si se activa `reversedDepthBuffer`, invertir la comparación.
- `renderOutput()` des/premultiplica por alpha: se le pasa `vec4(color, 1)` para no borrar el halo del bloom en zonas vacías.
- Dentro de nodos que acaban en un render-to-texture (todo lo que entra a `fxaa()`), usar `uv()` en lugar de `screenUV`/`screenSize`. El aspect del fondo va por uniform, que actualiza `Background.resize()`.
- No asumir que una API de `WebGLRenderer` existe igual en `WebGPURenderer`: comprobar en `node_modules/three/build/three.webgpu.js` o en la doc de r186.
- Si la página arranca oculta, `innerWidth/innerHeight` pueden valer 0. `Sizes` nunca devuelve 0 y la cámara se recupera de NaN en `resize()`.

## Asset: `public/models/rock_00/rockDemo_00.glb`

- Exportado desde Blender (Khronos glTF I/O). Es autocontenido: material "Rock" con baseColor, normal y occlusion embebidas como WebP 2048² (`EXT_texture_webp`), roughness 0.9 y metalness 0, doubleSided.
- Requiere `EXT_meshopt_compression` y `EXT_texture_webp`: el `GLTFLoader` de `Resources` ya tiene `setMeshoptDecoder(MeshoptDecoder)`; WebP lo soporta sin configurar nada.
- `GLTFLoader` resuelve flipY, espacios de color y la convención del normal map. Sin tangentes, deja `normalScale = (1, -1)`, que es lo correcto, así que no tocarlo. El código solo ajusta la anisotropy (8).
- El nodo viene desplazado ~1.97 en X: `Rock.setModel()` lo centra dentro de un pivot y **el pivot es lo que gira**.
- Los originales están en `../00/`. En Blender, la AO necesita el grupo "glTF Material Output" o no se exporta.
- La roca es muy oscura (albedo ≈ 0.08 sRGB): la luminancia lineal de la escena tiene mediana ≈ 0.02 y máximo ≈ 0.2. Por eso el threshold del bloom es 0.015.

## Dirección visual

Producto en estudio oscuro, nocturno, minimalista. La roca protagonista, centrada y girando lento (0.12 rad/s). Iluminación tenue pero con lectura clara del normal map, sin colores saturados ni efectos que distraigan.

Los valores finales los ajustó el usuario en el panel `#debug` y ya están como defaults en el código: cámara (`Camera.js` → `framing`), fondo (`Background.js` → `parameters`), exposure (`Renderer.js`), bloom (`PostProcessing.js` → `parameters`), luces y env map (`Environment.js`). **No cambiarlos sin pedirlo.** Si un cambio los afecta, avisar.
