# Especificación Técnica: P1 — CI/CD Pipeline (GitHub Actions)

**Objetivo:** Configurar la integración continua (CI) en GitHub Actions para asegurar que ningún cambio rompa el tipado de TypeScript, los tests unitarios o el empaquetado del paquete NPM.

## 1. Contexto del Proyecto
- **Entorno de ejecución:** Node.js `>=22.6.0` (definido en `package.json`).
- **Gestor de paquetes:** `npm`.
- **Dependencias de compilación nativa:** `better-sqlite3` y `sqlite-vec` (requieren toolchain de C/C++ y compilador en el runner de GitHub Actions).

## 2. Archivo a Crear
Ruta: `.github/workflows/ci.yml`

## 3. Disparadores del Workflow
El workflow debe dispararse ante:
- `push` a las ramas `main` y `develop`.
- `pull_request` dirigidos a `main` y `develop`.

## 4. Requisitos del Job (`test`)
- **Sistema Operativo:** `ubuntu-latest` (o matriz de `ubuntu-latest`, `macos-latest` si es viable; empezar con `ubuntu-latest` como base).
- **Node.js:** Versión `22.x` (usando `actions/setup-node@v4` con caché de `npm`).
- **Pasos secuenciales:**
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` con `node-version: 22` y `cache: 'npm'`
  3. `npm ci`
  4. `npm run typecheck` (`tsc --noEmit`)
  5. `npm run test:unit` (`vitest run`)
  6. `npm pack --dry-run` (valida que los ficheros definidos en `files` de `package.json` sean empaquetables sin errores).

## 5. Criterios de Aceptación
- El archivo `.github/workflows/ci.yml` es sintácticamente válido (YAML válido de GitHub Actions).
- Los comandos de validación local (`npm run typecheck`, `npm run test:unit`, `npm pack --dry-run`) se ejecutan sin fallos.
- No se modifican archivos fuera del scope de CI a menos que sea estrictamente necesario para la compatibilidad con CI.
- El commit final en la rama `feature/P1-ci-cd` sigue Conventional Commits: `ci: add github actions workflow for typecheck, tests and npm packaging`.
