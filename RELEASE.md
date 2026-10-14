# Release Checklist

Checklist operativo para cortar versiones de forma consistente.

## 1) Preparacion

- Definir version objetivo (SemVer pre-1.0):
  - `0.MINOR.0` para nuevas funcionalidades relevantes.
  - `0.MINOR.PATCH` para correcciones compatibles.
- Confirmar que `main` esta limpio:
  - `git status --short`
- Confirmar historial reciente:
  - `git log --oneline -10`

## 2) Validacion tecnica minima

- Ejecutar pruebas:
  - `npm run test`
- Verificar tipos:
  - `npx tsc --noEmit`

## 3) Actualizar changelog (espanol)

- Editar `CHANGELOG.md`.
- Mover cambios de `Unreleased` a un bloque versionado:
  - `## [X.Y.Z] - YYYY-MM-DD`
- Mantener secciones segun aplique:
  - `Added`, `Changed`, `Fixed`, `Technical`.
- Crear de nuevo bloque `Unreleased` vacio arriba.

## 4) Commit de release

- Crear rama de release:
  - `git checkout -b release/vX.Y.Z`
- Commit en ingles con Conventional Commits:
  - `git add CHANGELOG.md`
  - `git commit -m "docs(changelog): release vX.Y.Z"`

## 5) Tag local

- Crear tag anotado:
  - `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- Verificar tag:
  - `git tag --list`

## 6) Cierre local (sin remoto)

- Merge a `main` si aplica:
  - `git checkout main`
  - `git merge --no-ff release/vX.Y.Z`
- Confirmar estado final:
  - `git status --short`

## 7) Cuando exista remoto

- Subir rama:
  - `git push -u origin release/vX.Y.Z`
- Abrir PR y mergear.
- Subir tags:
  - `git push origin vX.Y.Z`
