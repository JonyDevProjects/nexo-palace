# Nexo-Palace — Session Audit

Fecha de la sesión: 2025-11-13

## Objetivo

Nexo-Palace es una **memoria de proyecto para agentes de IA**. Convierte la documentación, el código y las convenciones de un repositorio en un **índice híbrido** (semántico + léxico) y un **grafo de trazabilidad**, expuesto como CLI y servidor MCP.

El flujo es:

1. Indexa `docs/`, `codeDirs/` y `tasteDirs/` en una base SQLite local con embeddings.
2. Construye un grafo de dependencias y trazabilidad (qué requisito implementa cada módulo, qué tests lo cubren).
3. Expone búsqueda híbrida y consulta del grafo vía MCP para que cualquier agente consulte "lo que el proyecto ya sabe" sin releer ficheros linealmente.

Todo funciona localmente: SQLite + embeddings locales o Gemini/Ollama, sin servicios en la nube obligatorios.

## Estado actual

**Maturidad: Early alpha (v0.1.0)** — recién extraído como paquete independiente, 2 commits en git.

### Qué funciona (todos los tests pasan, typecheck limpio)

| Módulo | Funcionalidad |
|--------|--------------|
| `ingest-docs.ts` | Indexación documental; parseo Markdown por encabezados, extracción de metadatos y IDs de requisitos |
| `extract-code.ts` | Extracción AST con ts-morph; símbolos exportados, grafo de trazabilidad |
| `query.ts` | Búsqueda híbrida: BM25 (FTS5) + literal + vectorial, fusionada con RRF |
| `server.ts` | Servidor MCP con 4 herramientas (`memory_query`, `memory_status`, `memory_trace`, `memory_record_decision`) |
| `embedder.ts` | 4 proveedores enchufables: litert, Gemini, Ollama, offline, con auto-fallback |
| `trace.ts` | BFS sobre el grafo; distancia en saltos entre entidades |
| `episodes.ts` | Memoria decisional; persiste decisiones en BD, grafo y fichero Markdown |
| `drift.ts` | Detección de deriva; compara diffs de Git contra requisitos vinculados |
| `db.ts` | Capa SQLite con esquema de 7 tablas; migraciones e incremental embeddings |

### Qué falta

| Brecha | Implicación |
|--------|------------|
| Solo smoke test manual (15 assertions) | Sin framework ni regresión sistemática |
| Sin CI/CD | No hay automatización de calidad |
| Paquete no publicado en npm | Nadie puede instalarlo remotamente |
| Documentación solo en español | Barrera para adopción internacional |
| Relaciones `derived_from` y `deprecated_by` definidas pero muertas | Esquema desactualizado |

### Limitaciones conocidas (README)

- Playwright e2e que no importan componentes no generan aristas `tests`.
- `implements` requiere ID explícito en comentario; sin él, no se vincula.
- Proveedor `offline` solo captura solapamiento de términos, no paráfrasis.
- `memory_trace` devuelve `candidates` ante ambigüedades, no disimula automáticamente.
- Fragmentos < 160 caracteres no se embeben.
- Modelo local `nomic-embed-text` rinde bajo en corpus español vs Gemini Embedding 2.

## Próximos pasos (orden de prioridad y viabilidad)

### P1 — Publicar el paquete en npm
Sin publicar en npm, el proyecto no tiene ciclo de vida real. Verificar scripts de entrada (`bin/nexo-palace.js`, `src/cli.ts`, `src/server.ts`) con instalación limpia antes de publicar.

### P2 — CI/CD mínimo (GitHub Actions)
Workflow que ejecute `npm run typecheck` + `npm test` en cada push/PR. Bajo coste, alto impacto en confianza.

### P3 — Expandir suite de pruebas
Migrar de smoke tests manuales a framework con unit tests para `query.ts`, `ingest-docs.ts`, `extract-code.ts`, y más escenarios integrados del MCP.

### P4 — Traducir README a inglés
Cambio mayor para adopción externa. Aportaría contributor guide y bilingual documentation.

### P5 — Limpiar esquema: implementar o eliminar `derived_from` / `deprecated_by`
Cosmético pero elimina confusiones futuras en mantenimiento.

### Futuro (fuera de prioridad inmediata)

- Visualizador web del grafo de trazabilidad (TypeScript/cytoscape/D3)
- Más proveedores de embeddings (OpenAI, Anthropic)
- Ingesta incremental en watch mode
- Plugin system para procesadores de formatos no-Markdown

---

## Roadmap: Posicionamiento frente a Engram y Graphify

**Nexo-Palace** combina en un único motor lo que **Engram** y **Graphify** resuelven por separado: une la memoria episódica y de decisiones con un grafo de trazabilidad de código y búsqueda semántica vectorial híbrida, añadiendo una capa exclusiva de **gobernanza de producto** (**Requisitos $\leftrightarrow$ Código $\leftrightarrow$ Tests + Drift Detection**) que ninguna de las dos herramientas de mercado posee.

### Comparativa Técnica y Arquitectónica

| Dimensión | Nexo-Palace (Estado Actual) | Engram (Gentleman-Programming) | Graphify (Graphify-Labs) |
| --- | --- | --- | --- |
| **Enfoque Principal** | Trazabilidad Spec $\leftrightarrow$ Código + RAG Híbrido + Drift | Memoria persistente de sesiones y decisiones para agentes | Grafo de conocimiento estructural y multimodal del repo |
| **Stack / Runtime** | Node.js / TypeScript (`ts-morph`, `better-sqlite3`) | Binario nativo en Go (cero dependencias) | Python 3.10+ (`tree-sitter`, `networkx`) |
| **Almacenamiento** | SQLite unificado (`FTS5` + `sqlite-vec` + Grafo SQL) | SQLite + `FTS5` + chunks `.jsonl.gz` (Git-friendly) | Archivos locales (`graph.json`, `graph.html`, `GRAPH_REPORT.md`) |
| **Motor de Búsqueda** | Híbrido: BM25 + Literal + Vectorial (768d) con RRF | Léxico puro (BM25 / FTS5) y filtrado contextual | Traversal de grafo por comunidades y caminos (`path A B`) |
| **Análisis de Código** | AST TypeScript/JS (`ts-morph`) + etiquetas `@implements` | No analiza el AST del código fuente | AST políglota vía `tree-sitter` + schemas SQL + PDFs/Media |
| **Detección de Deriva** | Nativa (`drift.ts`): cruza `git diff` contra requisitos | No tiene (centrado en recordar contexto de sesión) | No audita el estado operativo de requisitos de negocio |
| **Interfaz Agente** | MCP Server (`stdio`) + CLI + Skills EGM | MCP Server (`stdio`/HTTP) + CLI + API HTTP + TUI | Skills nativas (`/graphify`) + CLI + Cloud MCP |

### Análisis Detallado: Dónde gana cada solución

#### 1. Nexo-Palace frente a Engram (`Gentleman-Programming/engram`)

- **Dónde gana Engram:** Al estar compilado en Go, es un binario único ultrarrápido y portable que incluye interfaz de terminal interactiva (TUI) y sincronización nativa de memorias en Git mediante fragmentos comprimidos (`.engram/chunks/*.jsonl.gz`). Es imbatible como "bloc de notas persistente" entre sesiones para cualquier agente.

- **Dónde gana Nexo-Palace:** Engram carece de búsqueda vectorial semántica (se limita a FTS5 léxico) y es ciego a la estructura del código fuente. **Nexo-Palace** sí entiende paráfrasis complejas gracias a sus embeddings de 768 dimensiones (vía LiteRT/Ollama o Gemini) y, sobre todo, construye un grafo que sabe exactamente qué archivos implementan cada historia de usuario (`EPC-01`, `US-102`) y qué tests los cubren. Además, Nexo-Palace vuelca las decisiones en `.commandcode/taste/decisions.md` en Markdown legible en Git sin renunciar a indexarlas vectorialmente.

#### 2. Nexo-Palace frente a Graphify (`Graphify-Labs/graphify`)

- **Dónde gana Graphify:** Su parser basado en `tree-sitter` es políglota y multimodal (mapea código en múltiples lenguajes, esquemas SQL, PDFs e imágenes), detecta comunidades conceptuales, genera visualizaciones interactivas (`graph.html`) y explica cada arista diferenciando entre relaciones explícitas (`EXTRACTED`) e inferidas (`INFERRED`) con pesos de confianza.

- **Dónde gana Nexo-Palace:** Graphify rechaza por diseño el uso de vectores ("*No embeddings, no vector store*") y requiere un pase semántico con LLM para documentos que no son código. **Nexo-Palace** combina lo mejor de ambos mundos: utiliza fusión RRF (*Reciprocal Rank Fusion*) sumando vectores locales en 24 ms + BM25 + coincidencias literales. Además, mientras Graphify mapea qué existe en el repositorio, **Nexo-Palace audita la evolución del producto**: extrae el estado operativo real de las tablas de tus specs (`done`, `on_hold`, `NEEDS_REVIEW`) y alerta automáticamente mediante `drift.ts` cuando un cambio en el código deja desfasada la documentación.

### Funcionalidades absorber de Engram y Graphify

Para que `nexo-palace` supere por completo a ambas herramientas como producto empaquetable, hay tres características concretas de sus repositorios que encajan directamente en tu arquitectura actual (`src/`):

#### 1. Aristas Tipadas por Confianza (Inspirado en Graphify)

Añadir una columna `confidence` (`EXTRACTED` vs `INFERRED`) en la tabla `edges` de `src/schema.sql`. Así, `memory_trace` podrá distinguir entre un vínculo explícito escrito por el desarrollador (`// @implements EPC-01`) y una relación deducida heurísticamente por mención en texto.

**Impacto:** Mayor transparencia en los resultados de `memory_trace` — el agente sabe cuándo un enlace es directo y cuándo es inferred.

#### 2. Camino más corto entre Entidades (`memory_path A B` de Graphify)

Añadir en `src/trace.ts` una consulta recursiva (`WITH RECURSIVE` en SQLite) que permita al agente preguntar cómo se conectan dos puntos distantes del proyecto (por ejemplo, desde un componente UI hasta una tabla de Supabase pasando por su requisito de seguridad).

**Impacto:** Respuestas explicativas tipo "¿Cómo llega X a Y?" con ruta completa paso a paso, muy útil para onboarding y debugging de impacto.

#### 3. Exportación / Sincronización Git-Friendly (Inspirado en Engram)

Dado que `palace/nexo-memory.sqlite3` está en `.gitignore`, añadir un subcomando en `src/cli.ts` (`nexo-palace export/import`) que vuelque la tabla `episodes` y los metadatos del grafo a un archivo JSONL comprimido o Markdown estructurado versionable en Git, permitiendo que otro desarrollador clone el repo y restaure la memoria episódica en 1 segundo sin re-indexar desde cero.

**Impacto:** Portabilidad total de la memoria episódica entre equipos/repos. Clonar + `import` = contexto disponible inmediatamente.

---

**Decision pendiente:** ¿Implementar estas tres mejoras en el código, o preparar primero un benchmark directo ejecutando consultas equivalentes entre los tres sistemas?
