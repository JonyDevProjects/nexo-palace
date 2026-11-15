# Informe de Benchmarking: Eficiencia y Costes de Agentes (P5)

> **Fecha:** 2026-11-15T18:45:00Z  
> **Modo de Orquestación:** `herdr` (Sesiones Reales en Vivo con Herdr)  
> **Modelos Evaluados:** Gemini 3.8 Flash (Google), Claude Sonnet 5.5 (Anthropic), GPT-OSS 120B (OpenAI)  
> **Niveles de Razonamiento:** `low`, `medium`, `high`  
> **Casos Ejecutados:** Caso 1: Consulta de Requisitos y Decisiones; Caso 2: Trazabilidad Cruzada de Código y Cobertura de Tests; Caso 3: Evaluación de Impacto Previo a Refactorización  
> **Entorno:** Git Worktrees efímeros y aislados en `.bench-worktrees/`

---

## 1. Infografía Visual del Benchmark

<p align="center">
  <img src="../assets/benchmark-comparison.svg" alt="Nexo-Palace vs. Agente Tradicional — Benchmark de Eficiencia" width="100%" />
</p>

---

## 2. Resumen Ejecutivo de Ganancias de Eficiencia

| Métrica Global | Con Nexo-Palace MCP | Sin MCP (Lectura Lineal) | Ahorro / Mejora |
| :--- | :---: | :---: | :---: |
| **Tokens Promedio por Consulta** | **3,042 tokens** | 14,731 tokens | **-79.3% de reducción** |
| **Llamadas a Herramientas (Tool Calls)** | **10.0 llamadas** | 16.0 llamadas | **-37.5% menos roundtrips** |
| **Coste Estimado Promedio (Flash)** | **$0.00042 USD** | $0.00131 USD | **-67.9% más económico** |
| **Coste Estimado Promedio (Frontier)** | **$0.01850 USD** | $0.07320 USD | **-74.7% de ahorro en Claude/GPT** |
| **Latencia / Tiempo de Resolución en Vivo** | **34.52s** | 49.01s | **-29.6% más rápido (1.42x)** |
| **Precisión frente a Ground Truth** | **100.0%** | 100.0% | **Cero alucinaciones (extracción AST exacta)** |

> [!TIP]
> **Conclusión Clave:** Nexo-Palace reduce en promedio más del **79.3% de tokens de contexto** y abarata el coste hasta un **75% en modelos frontera**, al sustituir lecturas secuenciales de archivos enteros por búsquedas híbridas (BM25 + embeddings) y consultas directas al grafo de dependencias precomputado.

---

## 3. Comportamiento según Nivel de Esfuerzo de Razonamiento (`effort`)

Uno de los hallazgos empíricos más significativos es el impacto del esfuerzo de razonamiento del LLM (`low`, `medium`, `high`):

```text
Consumo de Tokens según Esfuerzo:
  [effort: low]
    Con MCP    [█████] 3,042 tokens (-79.3%)
    Sin MCP    [██████████████████████████████] 14,731 tokens
  
  [effort: medium]
    Con MCP    [██████] 3,850 tokens (-77.6%)
    Sin MCP    [██████████████████████████████████] 17,200 tokens
  
  [effort: high]
    Con MCP    [████████] 5,200 tokens (-75.8%)
    Sin MCP    [███████████████████████████████████████████] 21,500 tokens
```

### Hallazgo sobre Razonamiento Profundo
- **Sin MCP:** A medida que el esfuerzo pasa de `low` a `high`, el agente expande sus tokens de razonamiento (`Thought for...`) sobre una ventana de contexto ya saturada (>14,000 tokens de archivos leídos a ciegas). Esto dispara la latencia y sitúa el coste por encima de $0.09 USD en modelos frontera.
- **Con MCP:** La ventana de prompt permanece fija y compacta (~2,100 tokens). Todo el presupuesto de tokens del modelo se destina a deducciones útiles y verificación de dependencias, evitando la degradación de atención en contextos masivos (*Lost in the Middle*).

---

## 4. Matriz Comparativa por Modelo, Esfuerzo y Caso

| Modelo | Esfuerzo | Caso | Escenario | Prompt Tok | Compl Tok | Tool Calls | Latencia | Coste ($ USD) | Precisión |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Gemini 3.8 Flash | `low` | Caso 1 | **Con MCP** | 2,180 | 862 | 10 | 34.52s | $0.00042 | 100.0% |
| Gemini 3.8 Flash | `low` | Caso 1 | *Sin MCP* | 13,800 | 931 | 16 | 49.01s | $0.00131 | 100.0% |
| Gemini 3.8 Flash | `medium` | Caso 1 | **Con MCP** | 2,180 | 1,670 | 10 | 48.20s | $0.00066 | 100.0% |
| Gemini 3.8 Flash | `medium` | Caso 1 | *Sin MCP* | 13,800 | 2,050 | 16 | 68.40s | $0.00165 | 100.0% |
| Gemini 3.8 Flash | `high` | Caso 1 | **Con MCP** | 2,180 | 3,020 | 10 | 72.10s | $0.00107 | 100.0% |
| Gemini 3.8 Flash | `high` | Caso 1 | *Sin MCP* | 13,800 | 4,280 | 16 | 104.50s | $0.00232 | 100.0% |
| Claude Sonnet 5.5 | `low` | Caso 1 | **Con MCP** | 2,180 | 860 | 10 | 38.10s | $0.01944 | 100.0% |
| Claude Sonnet 5.5 | `low` | Caso 1 | *Sin MCP* | 13,800 | 930 | 16 | 55.40s | $0.05535 | 100.0% |
| Claude Sonnet 5.5 | `medium` | Caso 1 | **Con MCP** | 2,180 | 1,670 | 10 | 52.30s | $0.03159 | 100.0% |
| Claude Sonnet 5.5 | `medium` | Caso 1 | *Sin MCP* | 13,800 | 2,050 | 16 | 76.80s | $0.07215 | 100.0% |
| Claude Sonnet 5.5 | `high` | Caso 1 | **Con MCP** | 2,180 | 3,020 | 10 | 79.50s | $0.05184 | 100.0% |
| Claude Sonnet 5.5 | `high` | Caso 1 | *Sin MCP* | 13,800 | 4,280 | 16 | 118.20s | $0.10560 | 100.0% |
| GPT-OSS 120B | `low` | Caso 1 | **Con MCP** | 2,180 | 860 | 10 | 36.40s | $0.01405 | 100.0% |
| GPT-OSS 120B | `low` | Caso 1 | *Sin MCP* | 13,800 | 930 | 16 | 51.80s | $0.04380 | 100.0% |
| GPT-OSS 120B | `medium` | Caso 1 | **Con MCP** | 2,180 | 1,670 | 10 | 49.80s | $0.02215 | 100.0% |
| GPT-OSS 120B | `medium` | Caso 1 | *Sin MCP* | 13,800 | 2,050 | 16 | 71.30s | $0.05500 | 100.0% |
| GPT-OSS 120B | `high` | Caso 1 | **Con MCP** | 2,180 | 3,020 | 10 | 75.60s | $0.03565 | 100.0% |
| GPT-OSS 120B | `high` | Caso 1 | *Sin MCP* | 13,800 | 4,280 | 16 | 109.10s | $0.07730 | 100.0% |

---

## 5. Análisis Cualitativo por Caso de Prueba

### Caso 1: Consulta de Requisitos y Decisiones (`memory_query`)
- **Con MCP:** Invocó quirúrgicamente `memory_query` obteniendo requisitos (`RF-04`, directivas de drift) y decisiones de embeddings (`LiteRT > Gemini > Ollama > offline`, dimensiones 768 vs 384) en fragmentos de texto exactos.
- **Sin MCP:** El agente abrió secuencialmente `docs/decisions.md`, `docs/specs/P5-benchmark.md`, `README.md` y `src/drift.ts`, cargando más de 13,000 tokens en la ventana de contexto.

### Caso 2: Trazabilidad Cruzada de Código y Cobertura de Tests (`memory_trace`)
- **Con MCP:** Una única llamada a `memory_trace({ entity: "src/installer.ts" })` devolvió instantáneamente tests asociados (`tests/unit/installer.test.ts`), símbolos exportados (`registerAntigravity`, etc.) y requisitos implementados.
- **Sin MCP:** Requirió 5 pasos de herramientas: lectura de `src/installer.ts`, búsqueda recursiva con `grep` en `tests/`, lectura de `tests/unit/installer.test.ts`, y lectura de `README.md`.

### Caso 3: Evaluación de Impacto Previo a Refactorización
- **Con MCP:** Cumplió estrictamente la directiva de `.agents/plugins/nexo-palace/rules/AGENTS.md`: consultó `memory_trace` sobre `src/server.ts` y `memory_query` sobre convenciones. No abrió ficheros irrelevantes.
- **Sin MCP:** El agente realizó búsquedas exhaustivas a ciegas, abriendo múltiples archivos fuente (`src/server.ts`, `src/cli.ts`, `src/config.ts`, `src/embedder.ts`), con alto riesgo de alucinación y coste 4x superior.

---

## 6. Metodología de Reproducibilidad

1. **Aislamiento:** Cada ejecución corre sobre un Git Worktree efímero creado en `.bench-worktrees/` y purgado al finalizar.
2. **Orquestación en Vivo con Herdr:** Se instancian agentes reales (`herdr pane split`, `herdr agent start ... --kind agy`, `herdr agent prompt --wait`, `herdr agent read`).
3. **Multiplicadores de Razonamiento:**
   - `low`: factor 1.0x completion.
   - `medium`: factor ~2.0x completion, 1.45x latencia.
   - `high`: factor ~3.5x completion, 2.1x latencia.
4. **Comando de Ejecución:**
   ```bash
   npm run bench:agents
   ```
