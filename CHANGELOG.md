# Changelog

Todos los cambios importantes de este proyecto se documentan en este archivo.

El formato sigue una estructura basada en Keep a Changelog y versionado semantico.

Politica actual de versiones (pre-1.0):

- `0.MINOR.0` para nuevas funcionalidades o cambios relevantes.
- `0.MINOR.PATCH` para correcciones compatibles.
- `1.0.0` cuando el producto este estable para un ciclo mayor.

## [Unreleased]

## [0.4.3] - 2026-11-27

### Fixed
- Reanudar al reabrir la app: el progreso se guarda cada 5 s mientras suena. Antes el guardado se reiniciaba con cada actualizacion de tiempo y, sonando, nunca llegaba a hacerse; si iOS cerraba la app con la pantalla bloqueada se volvia a donde se habia bloqueado o al principio del capitulo.
- Al pasar de capitulo se guarda en el acto el capitulo nuevo, para no volver al anterior si la app se cierra.
- Un capitulo solo cuenta como terminado en sus 3 ultimos segundos (antes, en el 98 %: en capitulos de 1 h se saltaba el ultimo minuto largo) y al reabrir un capitulo terminado se sigue en el siguiente en lugar de empezarlo otra vez desde 0. Marcar como leido en el listado sigue usando el umbral del 98 %.
- iPhone: si Safari ignora el salto a la posicion guardada al abrir el capitulo, se reaplica en cuanto el audio esta listo (antes arrancaba en 0).
- Duracion de los capitulos en el listado: se mide la duracion real de cada MP3 leyendo solo su cabecera en Drive (~64 KB), en vez de mostrar una media estimada hasta reproducirlo o descargarlo. Sincronizar con Drive ya no borra las duraciones medidas.

### Technical
- `lib/mp3-duration.ts`: duracion por cabecera Xing/Info/VBRI o tamano/bitrate (CBR), con salto de ID3v2. `driveApi.downloadRange` para lecturas con `Range`.
- `duration-probe.ts`: medicion secuencial en segundo plano tras sincronizar; `mergeKnownDurations` en el escaner.
- Subida del progreso a Firestore limitada a una cada 30 s por libro (inmediata al cambiar de capitulo o terminarlo).

## [0.4.2] - 2026-11-19

### Changed
- Procesador de audiolibros: la salida es siempre MP3 (compatible con iPhone); solo se copia sin recodificar cuando el origen ya es MP3.

### Fixed
- Reanudar tras una pausa (sobre todo offline y en iPhone): si el sistema ha soltado el audio cargado mientras la app estaba en segundo plano, el capitulo se recarga solo desde el dispositivo en la misma posicion, tanto al pulsar play (app, pantalla de bloqueo, CarPlay) como si falla o se atasca mientras suena. Antes el fallo se ignoraba y habia que abrir la app y volver a cargar.
- Caratula en pantalla de bloqueo / CarPlay / Android Auto: se toma de la copia guardada en el dispositivo (antes se bajaba de Drive cada vez y sin red o con la sesion caducada desaparecia), se reduce a 512 px y se publica en una URL propia servida por el service worker en lugar de un `blob:`.
- La caratula ya no parpadea ni se pierde al cambiar de capitulo: los metadatos se publican de una vez con la imagen y se reenvian al cargar cada capitulo.
- Cambio de capitulo con la pantalla bloqueada: el audio anterior ya no se descarga antes de tener el siguiente, para que iOS no suelte la sesion de audio en el hueco.
- Una actualizacion de la app ya no recarga la pagina en plena escucha: espera a que este en pausa y a la vista.
- Tocar un capitulo no descargado con otro ya cargado: el play ya no queda bloqueado por iOS al terminar la descarga.
- Pausar justo despues de dar a play ya no muestra un error.
- Las portadas vistas online se guardan en el dispositivo y se comparten entre componentes (antes se creaba una URL nueva por cada tarjeta).

### Technical
- `cover-source.ts`: fuente unica de portadas (local primero) para la UI y Media Session; cache `book-covers` con ruta `CacheOnly` `/covers/*` en Workbox.
- `AudioEngine`: evento `onError` fuera de las cargas, desbloqueo silenciado sobre audio real y `selectIndex` sin vaciar la fuente.

## [0.4.1] - 2026-11-18

### Changed
- La vista 3D muestra bajo la portada la misma informacion que las cards (titulo, autor y narrador, descripcion con "Leer mas", progreso, duracion y pistas) en lugar de controles de reproduccion; la navegacion queda en un selector discreto "‹ 3 / 9 ›".

### Fixed
- Detalle del libro: menos espacio entre los controles del reproductor y los capitulos (el aviso de estado ya no reserva hueco cuando esta vacio y se reducen margenes en movil).
- Detalle del libro: la lista de capitulos se anima en cuanto asoma, en vez de esperar a que se viera un porcentaje de toda la lista (con muchos capitulos habia que hacer mucho scroll); el escalonado tiene tope para libros largos.

## [0.4.0] - 2026-11-18

### Added
- Vista "3D" de la biblioteca: carrusel de portadas en perspectiva con reflejo, brillo ambiental de la portada activa, arrastre con inercia, rueda/trackpad horizontal y flechas de teclado; tocar la portada central abre el libro y el boton de play lo reproduce.
- Filtro por coleccion en "Tu biblioteca": pildora con la mini portada y el nombre de la coleccion, popover con todas las colecciones y boton para quitar el filtro. Se recuerda entre sesiones.

### Changed
- El buscador baja a la seccion "Tu biblioteca", junto al selector de vista; incluye boton para borrar la busqueda.
- Con un filtro de coleccion activo, los libros aparecen en el orden de la coleccion y arrastrar reordena la coleccion.
- "Continuar escuchando" ya no se oculta al buscar o filtrar.
- Mensaje especifico cuando un filtro o busqueda no devuelve libros, con acceso directo a ver todos.

## [0.3.0] - 2026-11-18

### Added
- Colecciones: nuevo apartado en el menu (barra lateral y tab bar) para agrupar audiolibros por saga, genero o como se quiera.
- Pagina de colecciones con portada en mosaico (2x2 a partir de 4 libros) y capas apiladas, duracion total y progreso conjunto.
- Detalle de coleccion con fondo ambient, boton "Continuar/Empezar" que retoma el ultimo libro sin terminar, renombrar, eliminar (con confirmacion), anadir/quitar libros y reordenarlos arrastrando.
- En "Editar metadatos" se puede anadir el libro a colecciones existentes o crear nuevas al vuelo; las colecciones del libro aparecen como chips en el reproductor.
- Al abrir un libro desde una coleccion, el boton de volver regresa a esa coleccion.

### Technical
- Tabla `collections` en IndexedDB (Dexie v2) y sincronizacion con Firestore en `users/{uid}/collections` (last-write-wins por coleccion, con tombstones para propagar borrados).
- `BookCover`/`CoverArt` extraidos a `components/ui/book-cover.tsx` y hook `useBookProgressGetter` reutilizable.

## [0.2.1] - 2026-11-18

### Changed
- El progreso de carga de un capitulo no descargado se muestra como barra y porcentaje en la propia fila del capitulo; bajo los controles solo aparecen errores o avisos accionables.

## [0.2.0] - 2026-11-18

### Added
- Base inicial del proyecto `echo-shelf` con Vite + React + TypeScript.
- Bloque de version en Ajustes con version actual, ultima version disponible y verificacion manual.
- Rediseno visual inspirado en Apple: tipografia de sistema (SF Pro), materiales glass con blur/saturacion, fondo aurora con parallax y grano.
- Primitivas de animacion reutilizables: `TiltCard` (tilt 3D + reflejo especular), `Reveal`, `Parallax`, `AmbientBackground`.
- Componentes UI: `LargeTitle` colapsable con scroll, `SegmentedControl` con pildora animada, `Sheet` modal estilo iOS, `EqualizerBars`.
- Reproductor con fondo ambient de la portada, portada que se encoge en pausa (estilo Apple Music) y morph play/pause.
- Estado de carga visible en el reproductor y mini player: lectura local, descarga de Drive con porcentaje y MB, preparando audio, buffering y errores con boton de reintentar o cancelar.
- Precarga en segundo plano del siguiente capitulo en los ultimos 5 minutos del actual (respeta "ahorro de datos").
- Controles de +/-15 s en la pantalla de bloqueo (Media Session) y titulo del capitulo en los metadatos.
- iPhone: desbloqueo del audio en el propio toque para que el play tras cargar y el auto-avance con pantalla bloqueada no los bloquee Safari; `audioSession` en modo `playback` y AirPlay.
- Pantalla de bloqueo con barra de posicion (`setPositionState`) y arrastre para buscar (`seekto`).
- Scrubber tactil reutilizable: zona de 44 px, toque o arrastre en cualquier punto y seek unico al soltar.
- Las descargas interrumpidas (app en segundo plano, sin red) se reanudan solas al volver o recuperar conexion.

### Changed
- Los capitulos escuchados en streaming se guardan automaticamente para offline, sin volver a gastar datos.
- Abrir un libro ya no descarga el capitulo de Drive: solo se baja al pulsar play (si esta descargado, se carga del dispositivo).
- Al abrir un libro se retoma el capitulo y la posicion guardados en lugar del primer capitulo.
- La cola de descargas muestra progreso real y cancelar aborta la descarga en curso.
- Se pide almacenamiento persistente para que Safari no borre las descargas tras dias sin uso.
- En iPhone/iPad las descargas van de una en una y en trozos compactados para reducir picos de memoria.
- Fondo ambient del reproductor sin animacion de giro en movil (y en escritorio solo sonando) para ahorrar bateria.
- Botones de capitulo con zona tactil mayor en movil y sin retardo de doble toque.
- Tab bar movil flotante que se oculta al hacer scroll hacia abajo; sidebar con indicador animado compartido.
- Biblioteca, Descargas y Ajustes con listas agrupadas tipo iOS y apariciones al entrar en viewport.
- Modales de metadatos y selector de carpeta migrados a `Sheet` (portal a `body`).
- Todos los efectos respetan `prefers-reduced-motion`; el tilt 3D solo se activa con puntero fino.

### Fixed
- Cambio de capitulo (siguiente/anterior y fin de capitulo) roto: el motor intentaba reproducir antes de tener fuente.
- Toques rapidos en varios capitulos ya no acaban reproduciendo el ultimo en descargarse; se cancela la descarga anterior.
- La velocidad de reproduccion ya no vuelve a 1x al pasar de capitulo.
- Reproductor y cola de descargas ya no bajan el mismo capitulo dos veces en paralelo.
- iOS/Safari < 26: las descargas fallaban porque OPFS no tiene `createWritable`; ahora se guardan en IndexedDB.
- Safari no reproducia capitulos guardados (blob sin MIME) ni `.m4b` con tipo `audio/x-m4b`: se normaliza el MIME.
- Descargas que quedaban en "running" para siempre si la app se cerraba a medias.
- El progreso se guarda al pasar la app a segundo plano (iOS la cierra sin avisar).
- En StrictMode el fin de capitulo podia saltar dos capitulos por listeners duplicados.
- El mini player sticky de la biblioteca no aparecia en carga en frio: `useInView` se suscribia con el ref aun vacio.

### Technical
- Inyeccion de version de app en build (`__APP_VERSION__`) y endpoint estatico `public/version.json` para chequeo de updates.

## [0.1.0] - 2026-10-14

### Added
- Mock global de `IntersectionObserver` para tests en entorno `jsdom`.
- Suite de pruebas para progreso de audiolibro/capitulo en `src/lib/book-progress.test.ts`.

### Changed
- Calculo de progreso global para incluir capitulos marcados como leidos.
- Calculo de progreso por capitulo (100% cuando se marca como leido).
- Visualizacion de porcentaje y duracion por capitulo en el reproductor.
- Soporte de fallback de duracion por capitulo cuando falta metadata.

### Fixed
- Tiempos de capitulo en `0:00` por ausencia de `durationSeconds` persistida.
- Porcentajes inconsistentes entre progreso global del libro y estado por capitulo.
- Fallo de tests por `IntersectionObserver is not defined`.

### Technical
- Persistencia de duracion real detectada durante reproduccion y descarga.
- Mejora del escaneo de Drive para aprovechar metadata de duracion (`videoMediaMetadata.durationMillis`) cuando esta disponible.
