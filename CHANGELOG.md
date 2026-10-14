# Changelog

Todos los cambios importantes de este proyecto se documentan en este archivo.

El formato sigue una estructura basada en Keep a Changelog y versionado semantico.

Politica actual de versiones (pre-1.0):

- `0.MINOR.0` para nuevas funcionalidades o cambios relevantes.
- `0.MINOR.PATCH` para correcciones compatibles.
- `1.0.0` cuando el producto este estable para un ciclo mayor.

## [Unreleased]

### Added
- Base inicial del proyecto `echo-shelf` con Vite + React + TypeScript.

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
