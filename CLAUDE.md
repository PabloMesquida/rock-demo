# Rock Demo

Demo 3D en el navegador con Three.js (WebGPU) y Vite. Una roca gira en un estudio nocturno y, a los 5 s, otras rocas más chicas caen sobre ella y se le quedan pegadas (física con Rapier). Están previstas hasta unas 30 rocas. Va a crecer por etapas: más rocas, instancias y experimentos con TSL. La arquitectura tiene que permitir sumar esas etapas sin rehacer el visor.

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
- `@dimforge/rapier3d-compat` 0.21.0 para la física. Es la variante "compat" (WASM embebido en base64) porque funciona sin plugins de Vite; a cambio suma ~4,3 MB al bundle (~1,7 MB gzip).
- Ninguna otra dependencia: lil-gui y el decoder de meshopt salen de `three/addons/libs/`. Antes de añadir una dependencia, preguntar.

## Arquitectura

Sigue `../Referencias/26 — Code structuring for bigger projects.pdf` (Bruno Simon / Three.js Journey):

```
src/main.js                         entrada: importa style.css e instancia Experience
src/Experience/Experience.js        singleton; crea todo y propaga resize → update → destroy
src/Experience/sources.js           lista de assets { name, type, path }
src/Experience/Camera.js            PerspectiveCamera + OrbitControls + encuadre automático (frame())
src/Experience/Renderer.js          WebGPURenderer (antialias false) + tone mapping; delega el frame a PostProcessing
src/Experience/Physics.js           mundo de Rapier sin gravedad global; init() async y un step por frame
src/Experience/PostProcessing.js    THREE.RenderPipeline: scene pass → bloom → renderOutput → fondo → FXAA → dither
src/Experience/Background.js        gradiente radial como nodo TSL (uniforms), en espacio de display sRGB
src/Experience/Utils/               EventEmitter, Sizes, Time, Resources, Debug
src/Experience/World/World.js       espera a Resources; crea Rock, Environment y Fragments; update() de lo que vive en escena
src/Experience/World/Rock.js        modelo, anisotropy, pivot de rotación, dimensiones para el encuadre, collider trimesh
src/Experience/World/Fragments.js   rocas chicas: un InstancedMesh por modelo, un cuerpo con hull convexo por roca, launch()
src/Experience/World/Environment.js key + rim light (ambas con sombras) y env map PMREM de un "night studio" procedural
```

Convenciones (las del PDF, respetarlas):
- Una clase por archivo, `export default class`. Estilo del PDF: llaves en línea propia (Allman), sin punto y coma, 4 espacios.
- Las clases obtienen lo que necesitan con `this.experience = new Experience()` (singleton). Excepciones: `PostProcessing` recibe el renderer por parámetro porque se crea dentro del constructor de `Renderer`, y `Fragments` recibe la roca porque `experience.world` puede no existir todavía mientras corre `World.setup()`.
- Métodos `setX()` en el constructor (`setInstance`, `setModel`, `setDebug`…). Además `resize()`, `update()` y `destroy()` cuando hacen falta, llamados desde el padre (nunca escuchar `window` directamente salvo en `Sizes`).
- Eventos con `EventEmitter`: `sizes 'resize'`, `time 'tick'`, `resources 'ready'` (más `'progress'` y `'error'`). Para no perder un `'ready'` que ya ocurrió, usar `resources.whenReady(cb)`. Si un asset falla, `'ready'` no llega nunca y el canvas queda invisible: mirar la consola.
- `Time` mide en **segundos** (el PDF usa ms). Toda animación usa `this.time.delta`. El delta está limitado a 0.1 s.
- Debug: solo con `#debug` en la URL. Cada clase crea su carpeta (`this.debug.ui.addFolder(...)`) dentro de `if(this.debug.active)`. `window.experience` solo existe en modo debug.
- No fragmentar en archivos pequeños sin valor ni meter abstracciones especulativas.

## Cómo añadir las próximas etapas

- Nuevos objetos o sistemas de escena (instancias, experimentos TSL): nueva clase en `World/`, creada en `World.setup()` y actualizada en `World.update()`.
- Más rocas que caen: copiar el GLB a `public/models/rock_NN/`, añadirlo a `sources.js` y sumar una entrada `{ resource, count }` en `Fragments.types` (o subir `count` para repetir un modelo). El hull se calcula solo. Probado con 30.
- Nuevos assets: entrada en `sources.js` (tipos soportados por `Resources`: `gltfModel` y `texture`; añadir loader ahí si hace falta otro).
- Nuevos efectos de pantalla: en `PostProcessing.js`, antes de `renderOutput()` si trabajan en lineal/HDR, después si trabajan sobre la imagen final. FXAA y el dither van siempre al final.
- Referencias en `../Referencias/` (carpeta local, fuera del repo): `11 — TSL - Post-processing.pdf`, `13 — TSL - Instances.pdf`, `19 — TSL - Sphere Particles Physics.pdf`, `26 — Code structuring for bigger projects.pdf`. Leer el que corresponda antes de implementar esa parte (`pdftotext -layout` funciona; el lector de PDF no).

## Física (`Physics.js`, `Rock.js`, `Fragments.js`)

Rapier en CPU. La primera versión seguía `19 — TSL - Sphere Particles Physics` (compute en GPU con esferas), pero se cambió para que las rocas apoyen con su forma real; de la lección quedan la gravedad hacia el centro y el delta limitado.

- **Espacio del pivot:** el mundo de Rapier está expresado en el espacio de `rock.pivot`, donde la roca principal no se mueve. Las mallas de los fragmentos son hijas del pivot, así que los pegados giran con la roca sin tocar la física. `launch()` calcula las posiciones iniciales en mundo y las pasa a ese espacio.
- **Lanzamiento:** las direcciones se reparten parejas sobre una esfera alrededor de la roca principal (retícula de Fibonacci con un giro al azar), así que llegan de todos lados, también desde el fondo y desde detrás de la cámara. Cada una arranca a la menor distancia en la que queda fuera de cuadro más `spawnMargin`, con tope en `spawnMax`: las que vienen del fondo no pueden salir de cuadro y arrancan a la vista, por eso todas crecen desde escala 0 durante `appearTime`. Las direcciones a menos de 30° del eje de la cámara se corren al borde de ese cono para que ninguna atraviese la lente.
- **Colliders:** la roca principal es un cuerpo fijo con un `trimesh` de sus triángulos reales (`Rock.setCollider()`); un hull le taparía las concavidades. Cada fragmento es un cuerpo dinámico con `convexHull` de sus vértices y CCD activado.
- **Gravedad:** el mundo no tiene gravedad global. `Fragments.update()` aplica a cada cuerpo un impulso hacia el origen (`gravity · masa · delta`).
- **Pegado:** mientras un fragmento toca algo fijo, su damping pasa de `damping` a `grip` (deja de rodar). Si además se mantiene por debajo de `stickSpeed` durante `stickTime`, su cuerpo pasa a `Fixed` y los siguientes pueden apilarse encima. Con `grip` bajo ruedan varios segundos antes de fijarse; `stickSpeed` tiene que quedar por encima de `gravity / grip` o no se pegan en pendiente.
- **Orden del frame:** `Experience.update()` hace cámara → `physics.update()` (step) → `world.update()` → render. `Fragments` lee las poses del step recién hecho y deja aplicado el impulso para el siguiente.
- Antes de `launch()` los cuerpos están deshabilitados y las instancias estacionadas en `y = 1000` (fuera del far plane), para que los pipelines se compilen durante el fade inicial.
- `world.free()` libera todos los cuerpos y colliders: no hay que quitarlos uno por uno en `destroy()`.
- `#debug` → carpeta `fragments`: parámetros, botón `launch` para repetir la caída y `show colliders` (líneas de `world.debugRender()`).

## Sombras

Todas las rocas generan y reciben sombras de las dos luces direccionales. `renderer.shadowMap.enabled` se activa en `Renderer.js`; cada luz se configura en `Environment.setShadow()` y cada malla activa `castShadow` / `receiveShadow` en su clase.

- La cámara de sombra de cada luz es una caja de ±2 centrada en el origen, con near 0.1 y far 12: cubre la roca principal con rocas apiladas y cualquier posición de luz que permita el panel. Si el conjunto crece más allá de 2 unidades del centro, hay que agrandarla.
- Mapas de 2048², PCF (el tipo por defecto), `bias` −0.0005. `normalBias` y `radius` van por luz: key 0.02 y 2; rim 0.034 y 5. Los tres se ajustan en `#debug` → `environment` → cada luz.
- El env map no proyecta sombras, así que las zonas en sombra no quedan negras.
- Un fragmento en vuelo solo proyecta sombra cuando entra en esa caja.

## Three r186 + WebGPU: trampas conocidas

- `renderer.render()`, `PMREMGenerator.fromScene()` y similares **lanzan error** antes de `await renderer.init()`. Por eso `Experience.init()` espera al renderer antes de crear `World` y arrancar `Time`.
- `PostProcessing` se renombró a **`THREE.RenderPipeline`** en r183 (el viejo es un alias deprecated). `renderAsync()` también está deprecated: usar `render()`.
- Con `outputColorTransform = false`, el tone mapping y sRGB los aplica `renderOutput()` a mano (necesario para que FXAA vea la imagen final).
- **Máscara del fondo por depth, no por alpha:** dentro del render-to-texture que crea `fxaa()`, el alpha del scene pass llega a 1. Se usa `step(depth, 0.999999)` sobre `scenePass.getTextureNode('depth')`. Si se activa `reversedDepthBuffer`, invertir la comparación.
- `renderOutput()` des/premultiplica por alpha: se le pasa `vec4(color, 1)` para no borrar el halo del bloom en zonas vacías.
- Dentro de nodos que acaban en un render-to-texture (todo lo que entra a `fxaa()`), usar `uv()` en lugar de `screenUV`/`screenSize`. El aspect del fondo va por uniform, que actualiza `Background.resize()`.
- No asumir que una API de `WebGLRenderer` existe igual en `WebGPURenderer`: comprobar en `node_modules/three/build/three.webgpu.js` o en la doc de r186.
- Para futuros experimentos con compute de TSL (ya no hay ninguno en el código): los storage buffers `vec3` se rellenan a `vec4` en la GPU y el backend **reemplaza** `attribute.array`, así que conviene usar siempre `vec4` si se escriben desde JS (y luego `buffer.value.needsUpdate = true`); y hay que guardar con `.toVar()` todo valor intermedio que se use después de modificar la variable de la que depende.
- `InstancedMesh` no recalcula sus bounds al mover instancias: `frustumCulled = false` o llamar a `computeBoundingSphere()`.
- Si la página arranca oculta, `innerWidth/innerHeight` pueden valer 0. `Sizes` nunca devuelve 0 y la cámara se recupera de NaN en `resize()`.

## Assets: `public/models/rock_NN/rockDemo_NN.glb`

`rock_00` es la roca principal; de `rock_01` en adelante son los fragmentos (mismo formato; texturas 1024² / 512², ~0.45 de diámetro frente a 0.67 × 1.23 × 0.81 de la principal). Lo que sigue describe `rock_00`:

- Exportado desde Blender (Khronos glTF I/O). Es autocontenido: material "Rock" con baseColor, normal y occlusion embebidas como WebP 2048² (`EXT_texture_webp`), roughness 0.9 y metalness 0, doubleSided.
- Requiere `EXT_meshopt_compression` y `EXT_texture_webp`: el `GLTFLoader` de `Resources` ya tiene `setMeshoptDecoder(MeshoptDecoder)`; WebP lo soporta sin configurar nada.
- `GLTFLoader` resuelve flipY, espacios de color y la convención del normal map. Sin tangentes, deja `normalScale = (1, -1)`, que es lo correcto, así que no tocarlo. El código solo ajusta la anisotropy (8).
- El nodo viene desplazado ~1.97 en X: `Rock.setModel()` lo centra dentro de un pivot y **el pivot es lo que gira**.
- Los originales de cada roca están en `../NN/` (carpetas locales, fuera del repo). En Blender, la AO necesita el grupo "glTF Material Output" o no se exporta.
- La roca es muy oscura (albedo ≈ 0.08 sRGB): la luminancia lineal de la escena tiene mediana ≈ 0.02 y máximo ≈ 0.2. Por eso el threshold del bloom es 0.015.

## Dirección visual

Producto en estudio oscuro, nocturno, minimalista. La roca protagonista, centrada y girando lento (0.12 rad/s). Iluminación tenue pero con lectura clara del normal map, sin colores saturados ni efectos que distraigan.

Los valores finales los ajustó el usuario en el panel `#debug` y ya están como defaults en el código: cámara (`Camera.js` → `framing`), fondo (`Background.js` → `parameters`), exposure (`Renderer.js`), bloom (`PostProcessing.js` → `parameters`), luces y env map (`Environment.js`). **No cambiarlos sin pedirlo.** Si un cambio los afecta, avisar.

Los valores de `Fragments.js` (`parameters`) y la sombra de la key light son un primer ajuste hecho sin verlo en tiempo real: todavía no los validó el usuario. La rim light (incluida su sombra) y la intensidad del env map sí los ajustó él. El encuadre de la cámara solo tiene en cuenta la roca principal: con muchas rocas el conjunto puede salirse del cuadro.
