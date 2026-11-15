# Roadmap y Próximos Pasos — Nexo-Palace

**Estado actual:** `@ijonydev/nexo-palace@0.1.1` (publicado en NPM)  
**Última actualización:** 14 de Noviembre de 2026

Este documento consolida todo lo pendiente recogido en [session-audit-2025-11-13.md](./session-audit-2025-11-13.md) y [README.md](../README.md), junto con la estrategia detallada para evolucionar la detección de requisitos y convenciones (`taste`) en la versión **`v0.2.0`**.

---

## 1. Hitos ya completados (desde v0.1.0 → v0.1.1)

- [x] **Publicación en NPM** (`@ijonydev/nexo-palace@0.1.1`, binarios `nexo-palace` y `nxpl`).
- [x] **Seguridad del instalador y BD:** permisos `0700`/`0600`, escritura atómica con `.bak`, validación estricta de JSON y `x-goog-api-key` en cabecera HTTP.
- [x] **Autodescubrimiento de proyecto:** detección automática de subproyectos (`viz-app/src`, etc.) y Markdown en raíz sin configuración manual.
- [x] **Normalización bilingüe de requisitos:** diccionario cruzado ES ↔ EN (`RF` ↔ `FR`, `RNF` ↔ `NFR`, `US` ↔ `HU`, `CU` ↔ `UC`, etc.).
- [x] **TUI interactiva y feedback:** menú con flechas/espacio, mapeo post-instalación y barra de progreso en tiempo real.

---

## 2. Pendientes técnicos e infraestructura (Corto plazo — `v0.1.x`)

### P1 — CI/CD mínimo (GitHub Actions)
- Añadir workflow en `.github/workflows/ci.yml` que ejecute en cada push/PR:
  - `npm run typecheck`
  - `npm run test:unit`
  - `npm pack --dry-run` (para validar que el empaquetado NPM no se rompe).

### P2 — Expandir la suite de pruebas
- Añadir tests unitarios y de integración para los módulos núcleo que aún dependen de smoke tests manuales:
  - `src/query.ts` (fusión RRF: BM25 + literal + vectorial).
  - `src/ingest-docs.ts` (resolución de estado desde tablas vs frontmatter).
  - `src/extract-code.ts` (resolución de imports, alias `@/` y aristas `tests`).
  - `src/trace.ts` y `src/drift.ts`.

### P3 — Documentación bilingüe (Inglés / Español)
- Traducir o mantener versión en inglés del `README.md` (`README.en.md` o README principal en inglés + `README.es.md`) y añadir una guía de contribución (`CONTRIBUTING.md`) para adopción externa.

### P4 — Limpieza del esquema SQLite
- Revisar `src/schema.sql` para implementar o eliminar relaciones declaradas sin uso actual (`derived_from`, `deprecated_by`) y evitar confusión en mantenimiento.

### P5 — Suite de Benchmarking de Eficiencia y Costes de Agentes (`Agent Cost Benchmark`)
- Implementar un harness automatizado (ej. `scripts/bench-agents.ts`) para medir empíricamente la reducción de tokens y coste monetario:
  - Comparar resolución de tareas idénticas: **Con MCP (Nexo-Palace)** vs. **Sin MCP (lectura lineal de archivos)**.
  - Soportar evaluación matricial: múltiples modelos (Gemini Flash/Pro, Claude Sonnet, GPT-4o) y distintos niveles de esfuerzo de razonamiento (`effort: low | medium | high`).
  - Orquestación automatizada de sesiones limpias utilizando **Herdr** (`herdr agent start/prompt/wait/read`) sobre Git Worktrees aislados (`herdr worktree`).
  - Generación de tablas comparativas de métricas: tokens de entrada, tokens de salida, llamadas a herramientas (`tool_calls`), coste estimado ($) y tiempo hasta resolución.

---

## 3. Evolución de Trazabilidad y Memoria (Inspirado en Graphify / Engram)

### T1 — Aristas tipadas por confianza (`EXTRACTED` vs `INFERRED`)
- Añadir una distinción explícita en `edges` (`confidence` + `origin: 'extracted' | 'inferred'`) para que `memory_trace` informe con transparencia si un enlace proviene de una declaración explícita (`// @implements RF-001`) o de una deducción heurística/semántica.

### T2 — Camino más corto entre entidades (`memory_path A B`)
- Implementar en `src/trace.ts` una consulta recursiva (`WITH RECURSIVE` en SQLite) expuesta como herramienta MCP (`memory_path`) para responder *"¿Cómo se conecta X con Y?"* paso a paso (p. ej. componente UI → servicio → requisito → test).

### T3 — Exportación / sincronización Git-friendly
- Añadir comandos `nxpl export` / `nxpl import` que vuelquen `episodes` (decisiones) y metadatos clave a un formato versionable en Git (JSONL comprimido o Markdown estructurado) para compartir memoria episódica entre desarrolladores al clonar el repo sin reindexar desde cero.

---

## 4. Estrategia para Detección de Requisitos y Convenciones (`v0.2.0`)

Hoy `nexo-palace` detecta requisitos por regex de prefijos (`RF-001`, `US-101`) y convenciones (`taste`) solo en rutas fijas (`DECISION_DIRS`). Para convivir con harnesses como **CommandCode**, **Claude Code**, **Cursor** o **Antigravity**, se proponen 5 líneas de evolución:

### 4.1. Detección multi-harness de convenciones (`taste`) e integración con Herdr
Ampliar el descubridor en `src/config.ts` para reconocer automáticamente los ficheros estándar de reglas de agentes y etiquetarlos con el tipo de nodo `taste` (prioritario frente a `doc` genérico):
- `.commandcode/taste/*.md`
- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
- `.cursorrules` y `.cursor/rules/*.mdc` (soportando frontmatter `globs` / `alwaysApply`)
- `.github/copilot-instructions.md`
- **Integración nativa con Herdr (Multi-Agent Swarm Memory):**
  - Soporte para que múltiples agentes que corran simultáneamente en paneles/workspaces de Herdr compartan una misma base de memoria viva (`.nexo-palace/memory.sqlite3`).
  - Habilitar que las decisiones registradas por un agente en un panel (`memory_record_decision`) estén inmediatamente disponibles para los agentes en los demás paneles (`memory_query`), reduciendo redundancia en swarms y equipos autónomos.

### 4.2. Parseo de metadatos y ponderación por confianza (`Confidence`)
En `.commandcode/taste/taste.md`, CommandCode registra preferencias aprendidas con un valor de confianza (ej. `- ... Confidence: 0.9`).
- **Acción:** Parsear cada regla individualmente extrayendo `confidence` (0.0–1.0), `source` y `category` en `meta`.
- **Impacto:** Inyectar el factor de confianza en el scoring de `memory_query` (`scope: "taste"`) para que las convenciones consolidadas (`>= 0.8`) prevalezcan sobre notas tentativas o documentación histórica.

### 4.3. Aprendizaje pasivo de convenciones (estilo CommandCode)
Replicar la capacidad de descubrir *taste* sin acoplarse a un único IDE/harness:
- **Consolidación desde `episodes`:** Cuando `memory_record_decision` acumula decisiones recurrentes con etiquetas afines, sugerir o promover automáticamente una regla consolidada en `decisionsFile` / `taste`.
- **Inferencia desde el proyecto y Git:** Detectar convenciones reales del repositorio (gestor de paquetes, framework de tests, linter, estructura de carpetas, estilo de commits) y almacenarlas como perfil base de `taste`.

### 4.4. Detección de requisitos sin IDs explícitos y trazabilidad híbrida
Muchos proyectos no numeran sus requisitos (`RF-001`), sino que usan prosa, PRDs o checklists:
- **Detección estructural:** Extraer requisitos implícitos de secciones tituladas `## Requisitos`, `## Requirements`, `## Criterios de aceptación`, listas con checkboxes (`- [ ] ...`) e historias en lenguaje natural (*"Como \<rol\> quiero \<acción\>..."*).
- **Trazabilidad híbrida (AST + Embeddings + Git):** Complementar los comentarios explícitos (`@implements`) con enlaces inferidos (`origin: 'inferred'`, `confidence: 0.6–0.75`) cruzando similitud semántica entre requisitos y símbolos/tests, así como referencias en `git log` (ej. `closes #12`, `feat(RF-005): ...`).

### 4.5. Arquitectura modular por adaptadores (`Detectors`)
Evitar que `src/markdown.ts` y `src/config.ts` crezcan con condicionales por cada formato:
- Definir interfaces ligeras `TasteDetector` y `RequirementDetector`.
- Implementar cada estándar como un detector independiente (`commandcode-taste`, `cursor-mdc`, `agents-md`, `adr`, `markdown-checklist`), facilitando añadir soporte a nuevos ecosistemas o herramientas mediante plugins.

---

## 5. Visión a Largo Plazo (`v0.3.0+`)

- **Modo Watch / Ingesta incremental:** Reindexar automáticamente al guardar archivos (`chokidar` o `fs.watch`) sin lanzar `nxpl map` manualmente.
- **Análisis políglota:** Soporte AST más allá de TypeScript/JavaScript (Python, Go, Rust) mediante `tree-sitter`.
- **Visualizador web del grafo:** Comando `nxpl ui` que levante una vista interactiva local del grafo (Requisitos ↔ Código ↔ Tests ↔ Decisiones).
- **Más proveedores de embeddings:** Adaptadores nativos para OpenAI, Voyage o modelos ONNX embebidos sin servidor externo.
