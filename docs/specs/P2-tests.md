# Especificación Técnica: P2 — Expansión de la Suite de Pruebas Unitarias

**Objetivo:** Extender la cobertura de pruebas automatizadas mediante `vitest` para los módulos centrales del motor: `src/query.ts` (fusión RRF, modos léxico y vectorial), `src/trace.ts` (resolución de nodos y relaciones en el grafo) y validaciones de parsing/ingesta.

## 1. Contexto y Arquitectura de Pruebas
- **Framework de test:** `vitest` (ejecutado con `npm run test:unit`).
- **Base de datos de prueba:** En memoria con `better-sqlite3` (`:memory:`) aplicando el esquema inicial (`src/schema.sql`).
- **Embedder en tests:** Usar proveedores mock (`EmbeddingProvider`) o vectores estáticos controlados para evitar dependencias de red o claves API durante las pruebas.

## 2. Archivos de Test a Crear
1. `tests/unit/query.test.ts`
2. `tests/unit/trace.test.ts`

## 3. Casos de Prueba Requeridos

### A. `tests/unit/query.test.ts`
- **Fusión RRF (Reciprocal Rank Fusion):**
  - Comprobar que elementos que coinciden tanto en la búsqueda léxica (BM25) como en la vectorial obtienen una mayor puntuación combinada que los que solo coinciden en una de ellas.
- **Modo `lexical`:**
  - Debe buscar solo por coincidencia de texto FTS5 y coincidencias literales de IDs (ej. `EPC-01`), ignorando la búsqueda KNN sin fallar.
- **Modo `vector`:**
  - Debe devolver resultados basados únicamente en distancia vectorial usando un mock embedding provider.
- **Filtros de ámbito (`scope`) y prefijos de ruta (`pathPrefix`):**
  - Filtrar correctamente por `scope: "requirement"` o `scope: "code"`.
  - Acotar resultados que comiencen por un `pathPrefix` determinado.

### B. `tests/unit/trace.test.ts`
- **Resolución de Entidades:**
  - Búsqueda exacta por ruta de archivo (`src/server.ts`).
  - Resolución por nombre/símbolo cuando hay identificadores únicos.
  - Gestión de ambigüedades (devolver `candidates` cuando hay múltiples coincidencias potenciales).
- **Recorrido del Subgrafo de Trazabilidad:**
  - Detección de enlaces directos: requisitos asociados (`RF-xx`, `US-xx`), tests que validan el código (`tests/unit/...`), y dependencias (`imports`).
  - Verificación de campos `relation`, `distance` y `via`.

## 4. Criterios de Aceptación
- Todos los tests nuevos en `tests/unit/query.test.ts` y `tests/unit/trace.test.ts` deben pasar en verde con `npm run test:unit`.
- No deben romper las 5 suites de tests existentes (`config.test.ts`, `installer.test.ts`, `markdown-requirements.test.ts`, `tui.test.ts`, `util.test.ts`).
- `npm run typecheck` debe ejecutarse con 0 errores de TypeScript.
- No depender de variables de entorno de producción ni realizar llamadas HTTP reales.
- El commit final en la rama `feature/P2-unit-tests` sigue Conventional Commits: `test: add unit test suites for query rrf engine and trace graph traversal`.
