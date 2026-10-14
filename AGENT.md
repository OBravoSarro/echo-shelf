# AGENT Workflow Guide

Guia operativa del proyecto para mantener consistencia en ramas, commits, versionado y changelog.

## 1) Idioma y convenciones

- Changelog: en espanol tecnico.
- Commits: en ingles, formato Conventional Commits.
- Ramas: en ingles, kebab-case.

## 2) Convencion de ramas

Usar siempre prefijos claros:

- `feat/<scope>-<short-description>`
- `fix/<scope>-<short-description>`
- `chore/<scope>-<short-description>`
- `docs/<scope>-<short-description>`
- `refactor/<scope>-<short-description>`
- `test/<scope>-<short-description>`
- `release/vX.Y.Z`

Ejemplos:

- `feat/player-track-progress`
- `fix/library-duration-fallback`
- `docs/changelog-policy`

## 3) Convencion de commits (obligatorio)

Formato:

`type(scope): summary`

Tipos permitidos:

- `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`, `revert`

Reglas:

- `summary` en imperativo y corto.
- Maximo ~72 caracteres en la primera linea.
- Sin emojis ni prefijos custom.

Ejemplos:

- `feat(player): add per-chapter progress calculation`
- `fix(library): include read chapters in global percentage`
- `test(progress): add fallback duration scenarios`

## 4) Politica de versionado

Se usa SemVer (`MAJOR.MINOR.PATCH`) con enfoque pre-1.0:

- `0.MINOR.0` para nuevas funcionalidades o cambios relevantes.
- `0.MINOR.PATCH` para correcciones y ajustes compatibles.
- `1.0.0` cuando el flujo principal y la estabilidad esten consolidados.

## 5) Politica de changelog

Archivo fuente: `CHANGELOG.md`.

Estructura:

- `## [Unreleased]`
- `## [X.Y.Z] - YYYY-MM-DD`

Secciones recomendadas:

- `Added`
- `Changed`
- `Fixed`
- `Technical` (opcional)

Flujo:

1. Cada cambio nuevo entra primero en `Unreleased`.
2. Al cortar version:
   - mover items de `Unreleased` a la nueva version fechada,
   - crear un nuevo bloque vacio `Unreleased`.

## 6) Flujo de trabajo recomendado (sin remoto)

1. Crear rama desde `main`.
2. Hacer cambios pequenos y commits atomicos (Conventional Commits).
3. Ejecutar pruebas y chequeo de tipos.
4. Actualizar `CHANGELOG.md` en `Unreleased`.
5. Merge local a `main` cuando todo este verde.

Cuando exista remoto, mantener el mismo flujo con PR antes de merge.

## 7) Releases

- Seguir el checklist de `RELEASE.md` para cada corte de version.
- Mantener `CHANGELOG.md` en espanol y commits de release en ingles (Conventional Commits).
