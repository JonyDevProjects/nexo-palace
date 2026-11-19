# Roadmap y Próximos Pasos — Nexo-Palace

**Estado actual:** `@ijonydev/nexo-palace@0.2.0` (publicado en NPM)  
**Última actualización:** 16 de Noviembre de 2026

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

### P4 — Limpieza y tipado del esquema SQLite (Completado)
- [x] Depurado `src/schema.sql`: eliminadas relaciones fantasma (`derived_from`, `deprecated_by`) e incorporado `symbol` como tipo de nodo oficial.
- [x] Tipado estricto en `src/db.ts`: exportadas constantes y uniones `NODE_TYPES` (`NodeType`) y `EDGE_RELATIONS` (`EdgeRelation`).
- [x] Tests unitarios en `tests/unit/util.test.ts` verificando la integridad de entidades y relaciones del grafo.

### P5 — Suite de Benchmarking de Eficiencia y Costes de Agentes (Completado)
- [x] Implementado harness automatizado [`scripts/bench-agents.ts`](../scripts/bench-agents.ts) con soporte para Git Worktrees efímeros (`herdr worktree` / `git worktree`).
- [x] Evaluación matricial Con MCP vs. Sin MCP sobre 6 modelos (Gemini 2.5 Flash/Pro, Claude 3.5 Sonnet/Haiku, GPT-4o/GPT-4o-mini) y 3 niveles de razonamiento (`low`, `medium`, `high`).
- [x] Ejecución de los 3 casos de prueba empíricos: consulta de requisitos (`memory_query`), trazabilidad cruzada (`memory_trace`) y evaluación de impacto pre-refactor (`AGENTS.md`).
- [x] Gráfica comparativa vectorial SVG en [`docs/assets/benchmark-comparison.svg`](./assets/benchmark-comparison.svg) y reporte generado en [`docs/benchmarks/P5-agent-benchmark-results.md`](./benchmarks/P5-agent-benchmark-results.md).
- [x] Documentación y métricas integradas en `README.md` y `README.en.md` (-84.1% tokens, -74.1% coste, 3x velocidad, +17.3 pts precisión).

#### Casos de prueba estándar para el Benchmark y Verificación MCP:

1. **Prueba de consulta de requisitos y decisiones (`memory_query`):**
   - **Hipótesis:** En un enfoque tradicional sin MCP, el agente se ve obligado a leer secuencialmente archivos extensos (`docs/decisions.md` o múltiples specs en `docs/specs/`). Con Nexo-Palace, realiza una búsqueda directa indexada (vectorial y léxica RRF).
   - **Prompts de prueba:**
     - `¿Cuáles son los requisitos y decisiones de diseño relacionados con la detección de drift o desalineación en el proyecto?`
     - `¿Qué decisiones se tomaron sobre el soporte de proveedores de embeddings locales (LiteRT vs Ollama)?`
   - **Traza y comportamiento esperado:**
     - Invocación de la herramienta MCP `memory_query` con parámetros contextuales (ej. `{ "query": "drift desalineación requisitos", "limit": 5 }`).
     - Obtención inmediata de fragmentos exactos (`RF-xx`, fragmentos de specs/decisions) sin abrir archivos secuencialmente.

2. **Prueba de trazabilidad cruzada de código (`memory_trace`):**
   - **Hipótesis:** Sin MCP, el agente abre archivos `.ts` con `read_file`, inspecciona manualmente imports y ejecuta múltiples búsquedas grep para inferir qué tests cubren el módulo. Con `memory_trace`, consulta directamente el grafo precomputado.
   - **Prompt de prueba:**
     - `Muestra la trazabilidad de src/installer.ts: qué tests lo cubren, qué símbolos exporta y qué requisitos implementa.`
   - **Traza y comportamiento esperado:**
     - Invocación de `memory_trace` con `{ "filePath": "src/installer.ts" }`.
     - Retorno instantáneo de nodos vinculados: tests (`tests/unit/installer.test.ts`), símbolos exportados (`registerAntigravity`, `detectClients`, etc.) y requisitos conectados en el grafo.

3. **Prueba de impacto previo a un refactor (cumplimiento de directiva activa):**
   - **Hipótesis:** Evaluar si el agente respeta las reglas de memoria activa y consulta el contexto del proyecto antes de modificar código, minimizando alucinaciones y regresiones.
   - **Prompt de prueba:**
     - `Quiero refactorizar src/server.ts. Antes de tocar código, consulta la memoria del proyecto para ver qué directivas, requisitos o tests dependen de él.`
   - **Comportamiento esperado:**
     - Cumplimiento de la directiva de memoria activa (`AGENTS.md`):
       1. Ejecución de `memory_trace` sobre `src/server.ts`.
       2. Ejecución de `memory_query` para revisar convenciones o requisitos asociados.
       3. Ausencia total de lecturas lineales a ciegas de archivos no relacionados.

---

## 3. Evolución de Trazabilidad y Memoria (Inspirado en Graphify / Engram)

### T1 — Aristas tipadas por confianza (`EXTRACTED` vs `INFERRED`)
- Añadir una distinción explícita en `edges` (`confidence` + `origin: 'extracted' | 'inferred'`) para que `memory_trace` informe con transparencia si un enlace proviene de una declaración explícita (`// @implements RF-001`) o de una deducción heurística/semántica.

### T2 — Camino más corto entre entidades (`memory_path A B`) (Completado)
- [x] Implementado en `src/trace.ts` mediante consulta recursiva (`WITH RECURSIVE` en SQLite con detección de ciclos BFS).
- [x] Expuesto como herramienta MCP `memory_path` en `src/server.ts` y comando CLI `nexo-palace path <from> <to>` en `src/cli.ts`.
- [x] Tests unitarios en `tests/unit/trace.test.ts` y `tests/unit/mcp-server.test.ts`.

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

### 4.6. Mapeo de Gobernanza de Workflow (Gitflow) y Adopción Proactiva en Harnesses
Las convenciones de desarrollo (como Gitflow y Conventional Commits) deben ser asumidas de forma proactiva por los agentes, evitando la modificación directa sobre ramas de integración o producción:
- **Indexación de `CONTRIBUTING.md` como nodo `taste`:** Clasificar automáticamente `CONTRIBUTING.md` (y guías de contribución equivalentes) con tipo `taste` (en lugar de `doc` genérico) para que sus directivas tengan prioridad en `memory_query` y consultas contextuales de convenciones.
- **Inyección de directivas de branching en `init-agent`:** Ampliar `src/agent-integration.ts` para detectar si el proyecto utiliza Gitflow (ramas `develop`/`main`) e inyectar explícitamente en los archivos de reglas generados (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, etc.) la directiva de no editar código directamente en `develop`/`main`, obligando a ramificar en `feature/<nombre>` o `fix/<nombre>`.
- **Consciencia de rama en el servidor MCP (`src/server.ts`):** Exponer la rama Git activa en `memory_status` e inyectar advertencias dinámicas de gobernanza en las `instructions` del protocolo MCP cuando el workspace apunte a ramas de integración o producción.
- **Guardarraíles en Git Hooks (`init-agent --hooks`):** Incorporar protecciones opcionales en el hook `pre-commit` para advertir o bloquear commits directos sobre ramas protegidas sin pasar por ramas de feature dedicadas.

### 4.7. Detección de Malas Prácticas en Implementaciones de Agentes (Prompt Hardcoding & AST Smells)
Los agentes de IA y desarrolladores de soluciones basadas en LLMs incurren frecuentemente en malas prácticas de implementación, tales como **hardcodear prompts, system prompts o directivas Markdown directamente en el cuerpo de funciones** (por ejemplo, arrays de cadenas concatenadas con `.join("\n")` o template literals extensos, como en `buildAgentProtocolMarkdown` en `src/agent-integration.ts`).

Esta práctica incrementa la deuda técnica, eleva el consumo innecesario de tokens al leer código fuente, entorpece la internacionalización/versionado de instrucciones y acopla la lógica de negocio con la formulación de prompts. Investigar cómo la memoria activa y el motor de Nexo-Palace pueden detectar y guiar la resolución de este anti-patrón:

- **Detección Estática en el Grafo AST (`src/extract-code.ts`):**
  - Identificar literales de cadena multilinea de longitud significativa (>150-200 caracteres), arrays extensos de strings o template literals masivos dentro de declaraciones de funciones y constantes exportadas.
  - Calcular la densidad texto/código (ratio de caracteres textuales frente a sentencias lógicas ejecutables).
- **Clasificación Híbrida de Prompts y Directivas:**
  - **Heurística léxica:** Detección de patrones canónicos de prompts para LLMs (encabezados `#`, listas de directivas en modo imperativo, menciones a herramientas MCP, marcadores de contexto o roles `<system>`, etc.).
  - **Similitud semántica vectorial:** Clasificar bloques sospechosos frente a un espacio de embeddings calibrado para instrucciones/prompts frente a constantes o mensajes de error habituales.
- **Registro de Hallazgos y Trazabilidad en el Grafo:**
  - Modelar advertencias de calidad o anti-patrones (`code_smell:hardcoded_prompt`) asociados al nodo del símbolo infractor en SQLite, accesibles desde `memory_trace` y el comando de drift/gobernanza.
- **Estrategias de Refactorización Asistida:**
  - Guiar a los agentes y desarrolladores para extraer prompts a recursos externos desacoplados:
    - Archivos Markdown dedicados (ej. `prompts/*.md`, `templates/*.md`) con interpolación de variables.
    - Catálogos estructurados en JSON/YAML (`prompts.json`) que faciliten versionado y gobernanza.
  - Ofrecer utilidades de referencia o resolución dinámica en tiempo de ejecución.
- **Superficie MCP y CLI de Calidad (`nxpl audit` / `memory_audit`):**
  - Evaluar la exposición de una herramienta MCP de auditoría que los agentes puedan ejecutar antes de cerrar sus tareas, validando que el código recién escrito respete las directivas arquitectónicas y no introduzca prompts hardcodeados.

### 4.8. Optimización de Eficiencia, Coste de Tokens y Calidad de Respuestas en Harnesses (Tool Steering & Payload Compactness)
A partir de la comparativa empírica de consumo y precisión de respuestas entre agentes para consultas de estado y arquitectura, se identificó un patrón de ineficiencia por sobre-uso de herramientas y dispersión de contexto (hasta +20% en tokens y degradación de frescura):

- **Enrutamiento por Intención en Directivas y Protocolos (`src/agent-integration.ts`, `src/server.ts`):**
  - Actualizar `buildAgentProtocolMarkdown` y las `instructions` del `McpServer` con una matriz clara de decisión:
    - *Estado y salud operativa:* Prescribir `memory_status` + `memory_drift` combinados con verificación en vivo (`git log`, `npm test`, `typecheck`). Evitar expresamente invocar `memory_trace` para preguntas de estado general.
    - *Búsqueda documental dirigida:* Guiar a usar `memory_query(query, scope: "doc", limit: 3)` para localizar specs o roadmaps, evitando lecturas especulativas a ciegas (`Read(ROADMAP.md)`) o comandos de búsqueda manual (`find`).
    - *Exploración de código:* Prescribir `memory_trace` con `depth: 1` acotado exclusivamente a archivos y símbolos concretos.
  - Actualizar el hook `SessionStart` (`buildAntigravitySessionHookScript`) con una chuleta explícita de subcomandos CLI (`stats`, `drift`, `query --scope`, `trace --depth 1`) para evitar lecturas intermedias de `SKILL.md` o `--help`.
- **Desduplicación y Fidelidad de Decisiones (`src/ingest-docs.ts`, `src/episodes.ts`):**
  - Extraer en `parseAsDecisions` el ID original de la línea `* **Episodio:** \`decision:...\`` en `docs/decisions.md` para evitar duplicar nodos (`decision:<fecha>:<titulo>` frente a `decision:<timestamp>`) en `nodes` y `chunks`.
  - Purgar la saturación de fragmentos idénticos en las respuestas de `memory_trace` y `memory_query`.
- **Enriquecimiento Operativo de `memory_status` y `stats` (`src/server.ts`, `src/db.ts`):**
  - Incorporar en el payload de `memory_status` información viva y compacta del proyecto: rama Git activa, estado del árbol de trabajo (`dirty`), último commit (`HEAD`), versión en `package.json`, distribución de requisitos por estado (`done`, `draft`, `NEEDS_REVIEW`) y títulos de las últimas 3 decisiones registradas.
  - Resolver consultas de estado global en una única llamada MCP compacta sin necesidad de múltiples consultas suplementarias.
- **Compactación de Respuestas y Control de Verbosidad (`src/trace.ts`, `src/query.ts`, `src/server.ts`):**
  - Ajustar la profundidad por defecto de `memory_trace` a `depth: 1` y acotar menciones débiles (`via: "path-mention"` en `documents`) para eliminar respuestas de +250 líneas.
  - Exponer y documentar oficialmente `scope: "decision"` en el schema MCP de `memory_query`.
  - Añadir soporte de ordenación temporal (`sort: "recent" | "relevance"`) y flag `includeContent: false` en `memory_query` para recuperar listados de referencias ultraligeros (-80% tokens) antes de decidir qué fragmento inspeccionar en detalle.
  - Aclarar en el schema de `memory_trace` qué entidades son trazables (excluyendo manifiestos JSON como `package.json` para evitar consultas fallidas).

---

## 5. Visión a Largo Plazo (`v0.3.0+`)

- **Modo Watch / Ingesta incremental:** Reindexar automáticamente al guardar archivos (`chokidar` o `fs.watch`) sin lanzar `nxpl map` manualmente.
- **Análisis políglota:** Soporte AST más allá de TypeScript/JavaScript (Python, Go, Rust) mediante `tree-sitter`.
- **Visualizador web del grafo:** Comando `nxpl ui` que levante una vista interactiva local del grafo (Requisitos ↔ Código ↔ Tests ↔ Decisiones).
- **Más proveedores de embeddings:** Adaptadores nativos para OpenAI, Voyage o modelos ONNX embebidos sin servidor externo.
