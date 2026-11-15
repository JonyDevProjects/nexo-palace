# Especificación Técnica: P3 — Documentación Bilingüe y Guía de Contribución

**Objetivo:** Facilitar la adopción internacional y la colaboración abierta en el repositorio creando la versión en inglés de la documentación (`README.en.md`) y la guía de contribución del proyecto (`CONTRIBUTING.md`), además de enlazar ambas desde el `README.md` principal.

## 1. Archivos a Crear / Modificar
1. **Crear `README.en.md`:** Traducción fiel y técnica al inglés del `README.md` principal.
2. **Crear `CONTRIBUTING.md`:** Guía detallada para desarrolladores y contribuidores de código abierto.
3. **Modificar `README.md`:** Añadir switcher de idioma en el encabezado (ej. `[English](README.en.md) | [Español](README.md)`) y enlace a `CONTRIBUTING.md`.

## 2. Contenido Requerido en `README.en.md`
- **Badges y Título:** `@ijonydev/nexo-palace`, npm package, licencia MIT.
- **Problem & Solution:** Explicar el problema de pérdida de contexto/alucinaciones en agentes de IA y cómo Nexo-Palace proporciona memoria activa mediante índice híbrido (BM25 + sqlite-vec) y grafo de trazabilidad.
- **Key Features:**
  - Hybrid search with Reciprocal Rank Fusion (RRF).
  - Traceability graph (requirements ↔ code ↔ tests ↔ decisions).
  - Dual interface: CLI (`nexo-palace` / `nxpl`) & MCP Server (`@modelcontextprotocol/sdk`).
  - Interactive zero-config installer with project auto-discovery.
  - Bilingual requirement normalization (ES ↔ EN: `RF`/`FR`, `RNF`/`NFR`, `US`/`HU`).
- **Quick Start & Installation:**
  - `npx @ijonydev/nexo-palace` / `npm install -g @ijonydev/nexo-palace`.
  - MCP Client setup (Claude Desktop, Antigravity, Cursor, etc.).
- **Tools exposed via MCP:** `memory_query`, `memory_trace`, `memory_status`, `memory_record_decision`.

## 3. Contenido Requerido en `CONTRIBUTING.md`
- **Requisitos de desarrollo:** Node.js `>=22.6.0`, `npm`.
- **Flujo de trabajo Gitflow:**
  - Rama `main` como producción/estable.
  - Rama `develop` para desarrollo activo.
  - Ramas `feature/<nombre>` para nuevas funcionalidades o correcciones.
- **Estilo de Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `refactor:`).
- **Scripts de Validación Local:**
  - `npm run typecheck`
  - `npm run test:unit`
  - `npm pack --dry-run`
- **Pautas de Código:** TypeScript moderno con `--experimental-strip-types`, imports con extensiones `.ts`, manejo estricto de tipos sin `any` innecesarios.

## 4. Criterios de Aceptación
- `README.en.md` redactado en inglés técnico natural, profesional y sin traducciones literales o errores gramaticales.
- Switcher de idioma visible en la parte superior tanto de `README.md` como de `README.en.md`.
- `CONTRIBUTING.md` cubre el flujo de Gitflow, convenciones de commit y scripts de testing.
- `npm run typecheck` y `npm run test:unit` continúan pasando sin errores.
- El commit final en la rama `feature/P3-docs-i18n` sigue Conventional Commits: `docs: add english readme, language switcher and contributing guide`.
