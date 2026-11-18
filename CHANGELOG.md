# Changelog

Todos los cambios importantes de este proyecto se documentan en este archivo.

El formato sigue una estructura basada en Keep a Changelog y versionado semantico.

Politica actual de versiones (pre-1.0):

- `0.MINOR.0` para nuevas funcionalidades o cambios relevantes.
- `0.MINOR.PATCH` para correcciones compatibles.
- `1.0.0` cuando el producto este estable para un ciclo mayor.

## [Unreleased]

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
