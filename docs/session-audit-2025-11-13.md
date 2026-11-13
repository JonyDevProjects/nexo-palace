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
