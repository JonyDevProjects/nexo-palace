# Especificación Técnica: P5 — Suite de Benchmarking de Eficiencia y Costes de Agentes (`Agent Cost Benchmark`)

**Objetivo:** Establecer una suite automatizada de benchmarking para evaluar de forma empírica la ganancia de eficiencia, reducción de tokens de contexto, coste computacional/económico y precisión entre dos escenarios:
1. **Agente potenciado con Nexo-Palace MCP** (`memory_query`, `memory_trace`).
2. **Agente tradicional sin MCP** (navegación y lectura lineal de ficheros vía `read_file` y `grep`).

La evaluación medirá el desempeño cruzando diferentes familias de modelos y niveles de esfuerzo de razonamiento (`reasoning effort`).

---

## 1. Matriz de Evaluación

### A. Modelos a Comparar
- **Google DeepMind:** Gemini 2.5 Flash, Gemini 2.5 Pro (o equivalentes de última generación).
- **Anthropic:** Claude 3.5 Sonnet, Claude 3.5 Haiku.
- **OpenAI:** GPT-4o, GPT-4o-mini.

### B. Niveles de Esfuerzo de Razonamiento
- `effort: low`
- `effort: medium`
- `effort: high`

### C. Métricas Clave a Capturar
- **Tokens de entrada (Prompt tokens / Context window usage).**
- **Tokens de salida (Completion tokens).**
- **Llamadas a herramientas (`tool_calls` count).**
- **Latencia / Tiempo total de resolución (segundos).**
- **Coste estimado ($ USD).**
- **Precisión de la respuesta:** Tasa de acierto frente a la verdad-terreno (*ground truth*) de requisitos, dependencias y tests.

---

## 2. Batería de Casos de Prueba del Benchmark

### Caso 1: Consulta de Requisitos y Decisiones (`memory_query`)
- **Problema:** El agente debe identificar decisiones de diseño o requisitos específicos dispersos en la documentación sin conocer la estructura interna de archivos.
- **Escenario Tradicional (Sin MCP):**
  - El agente lista directorios, lee documentos extensos secuencialmente (`docs/decisions.md`, `docs/specs/*`, `README.md`) y consume miles de tokens cargando contexto irrelevante.
- **Escenario Optimizado (Con Nexo-Palace MCP):**
  - El agente invoca `memory_query` con búsqueda híbrida RRF (BM25 + embeddings).
- **Prompts de Prueba:**
  1. `¿Cuáles son los requisitos y decisiones de diseño relacionados con la detección de drift o desalineación en el proyecto?`
  2. `¿Qué decisiones se tomaron sobre el soporte de proveedores de embeddings locales (LiteRT vs Ollama)?`
- **Traza esperada:**
  ```json
  { "tool": "memory_query", "args": { "query": "drift desalineación requisitos", "limit": 5 } }
  ```
- **Criterio de Validación:**
  - El agente devuelve los identificadores de requisitos exactos (`RF-xx`, `US-xx`) y las decisiones registradas sin invocar lecturas lineales innecesarias.

---

### Caso 2: Trazabilidad Cruzada de Código y Cobertura de Tests (`memory_trace`)
- **Problema:** Conocer qué tests cubren un archivo de implementación específico y qué requisitos implementa.
- **Escenario Tradicional (Sin MCP):**
  - El agente abre el archivo fuente con `read_file`, extrae los símbolos a mano, hace búsquedas de texto con `grep` en `tests/`, y abre cada test individualmente para verificar si realmente lo importa y prueba.
- **Escenario Optimizado (Con Nexo-Palace MCP):**
  - El agente consulta el grafo de dependencias precomputado mediante `memory_trace`.
- **Prompt de Prueba:**
  - `Muestra la trazabilidad de src/installer.ts: qué tests lo cubren, qué símbolos exporta y qué requisitos implementa.`
- **Traza esperada:**
  ```json
  { "tool": "memory_trace", "args": { "filePath": "src/installer.ts" } }
  ```
- **Criterio de Validación:**
  - Recuperación en un solo paso de:
    - Tests asociados (`tests/unit/installer.test.ts`).
    - Símbolos exportados (`registerAntigravity`, `detectClients`, etc.).
    - Requisitos vinculados en el grafo.

---

### Caso 3: Evaluación de Impacto Previo a Refactorización
- **Problema:** Comprobar el cumplimiento de las directivas de memoria activa y la precisión del análisis de impacto antes de modificar código crítico.
- **Escenario Tradicional (Sin MCP):**
  - El agente comienza a editar directamente o realiza búsquedas exhaustivas a ciegas con alto riesgo de regresión o alucinación.
- **Escenario Optimizado (Con Nexo-Palace MCP):**
  - Cumplimiento de las directivas en `.agents/plugins/nexo-palace/rules/AGENTS.md`.
- **Prompt de Prueba:**
  - `Quiero refactorizar src/server.ts. Antes de tocar código, consulta la memoria del proyecto para ver qué directivas, requisitos o tests dependen de él.`
- **Comportamiento Esperado:**
  1. Ejecución de `memory_trace` sobre `src/server.ts`.
  2. Ejecución de `memory_query` para contrastar requisitos y convenciones.
  3. Cero lecturas de archivos ajenos al subgrafo de impacto.

---

## 3. Infraestructura y Automatización

- **Aislamiento de Sesiones:** Utilización de **Herdr** (`herdr agent start/prompt/wait/read`) sobre Git Worktrees efímeros (`herdr worktree`) para garantizar ejecuciones reproducibles y sin estado previo residual.
- **Generador de Reportes:** Script automatizado (`scripts/bench-agents.ts`) que agregará los resultados en tablas Markdown comparativas y gráficos de coste vs. precisión.
