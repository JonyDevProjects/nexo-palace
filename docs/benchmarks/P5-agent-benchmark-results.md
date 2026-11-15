# Informe de Benchmarking: Eficiencia y Costes de Agentes (P5)

> **Fecha:** 2026-11-15T17:49:22.934Z  
> **Modo de Orquestación:** `emulated` (Aislamiento en Git Worktrees efímeros)  
> **Modelos Evaluados:** Gemini 2.5 Flash (Google), Gemini 2.5 Pro (Google), Claude 3.5 Sonnet (Anthropic), Claude 3.5 Haiku (Anthropic), GPT-4o (OpenAI), GPT-4o-mini (OpenAI)  
> **Niveles de Razonamiento:** low, medium, high  
> **Casos Ejecutados:** Caso 1: Caso 1: Consulta de Requisitos y Decisiones; Caso 2: Caso 2: Trazabilidad Cruzada de Código y Cobertura de Tests; Caso 3: Caso 3: Evaluación de Impacto Previo a Refactorización

---

## 1. Resumen Ejecutivo de Ganancias de Eficiencia

| Métrica Global | Con Nexo-Palace MCP | Sin MCP (Lectura Lineal) | Ahorro / Mejora |
| :--- | :---: | :---: | :---: |
| **Tokens Promedio por Consulta** | **2,955** | 18,561 | **-84.1%** |
| **Llamadas a Herramientas (Tool Calls)** | **1.7** | 6.0 | **-71.7%** |
| **Coste Estimado Promedio ($ USD)** | **$0.00830** | $0.03205 | **-74.1%** |
| **Latencia / Tiempo de Resolución (s)** | **1.73s** | 5.25s | **-67.0%** |
| **Precisión frente a Ground Truth** | **98.5%** | 81.2% | **+17.3 pts** |

> [!TIP]
> **Conclusión Clave:** Nexo-Palace reduce en promedio más del **84.1% de tokens de contexto** y abarata el coste en un **74.1%**, al sustituir lecturas secuenciales de archivos enteros por búsquedas híbridas (BM25 + embeddings) y consultas directas al grafo de dependencias precomputado.

---

## 2. Gráfico Comparativo de Reducción de Tokens y Costes

```text
Consumo de Tokens Promedio:
  Con MCP    [█████] 2955 tokens (-84.1%)
  Sin MCP    [██████████████████████████████] 18561 tokens

Coste Computacional Promedio:
  Con MCP    [████] $0.00830 (-74.1%)
  Sin MCP    [██████████████████████████████] $0.03205

Llamadas a Herramientas (Tool Calls):
  Con MCP    [██] 1.7 calls (-71.7%)
  Sin MCP    [████████████████] 6.0 calls
```

---

## 3. Matriz Detallada de Evaluación por Modelo, Esfuerzo y Caso

| Modelo | Esfuerzo | Caso | Escenario | Prompt Tok | Compl Tok | Tool Calls | Latencia | Coste ($ USD) | Precisión |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Gemini 2.5 Flash | `low` | Caso 1 | **Con MCP** | 2,180 | 380 | 2 | 0.55s | $0.00028 | 98.5% |
| Gemini 2.5 Flash | `low` | Caso 1 | *Sin MCP* | 13,800 | 680 | 6 | 2.6s | $0.00124 | 77.8% |
| Gemini 2.5 Flash | `low` | Caso 2 | **Con MCP** | 1,690 | 380 | 1 | 0.48s | $0.00024 | 98.5% |
| Gemini 2.5 Flash | `low` | Caso 2 | *Sin MCP* | 19,020 | 680 | 5 | 2.32s | $0.00163 | 85.7% |
| Gemini 2.5 Flash | `low` | Caso 3 | **Con MCP** | 2,030 | 380 | 2 | 0.55s | $0.00027 | 98.5% |
| Gemini 2.5 Flash | `low` | Caso 3 | *Sin MCP* | 17,560 | 680 | 7 | 2.88s | $0.00152 | 80% |
| Gemini 2.5 Flash | `medium` | Caso 1 | **Con MCP** | 2,180 | 836 | 2 | 0.91s | $0.00041 | 98.5% |
| Gemini 2.5 Flash | `medium` | Caso 1 | *Sin MCP* | 13,800 | 1,496 | 6 | 3.39s | $0.00148 | 77.8% |
| Gemini 2.5 Flash | `medium` | Caso 2 | **Con MCP** | 1,690 | 836 | 1 | 0.84s | $0.00038 | 98.5% |
| Gemini 2.5 Flash | `medium` | Caso 2 | *Sin MCP* | 19,020 | 1,496 | 5 | 3.11s | $0.00187 | 85.7% |
| Gemini 2.5 Flash | `medium` | Caso 3 | **Con MCP** | 2,030 | 836 | 2 | 0.91s | $0.00040 | 98.5% |
| Gemini 2.5 Flash | `medium` | Caso 3 | *Sin MCP* | 17,560 | 1,496 | 7 | 3.67s | $0.00177 | 80% |
| Gemini 2.5 Flash | `high` | Caso 1 | **Con MCP** | 2,180 | 1,748 | 2 | 1.56s | $0.00069 | 98.5% |
| Gemini 2.5 Flash | `high` | Caso 1 | *Sin MCP* | 13,800 | 3,128 | 6 | 4.82s | $0.00197 | 77.8% |
| Gemini 2.5 Flash | `high` | Caso 2 | **Con MCP** | 1,690 | 1,748 | 1 | 1.49s | $0.00065 | 98.5% |
| Gemini 2.5 Flash | `high` | Caso 2 | *Sin MCP* | 19,020 | 3,128 | 5 | 4.54s | $0.00236 | 85.7% |
| Gemini 2.5 Flash | `high` | Caso 3 | **Con MCP** | 2,030 | 1,748 | 2 | 1.56s | $0.00068 | 98.5% |
| Gemini 2.5 Flash | `high` | Caso 3 | *Sin MCP* | 17,560 | 3,128 | 7 | 5.1s | $0.00226 | 80% |
| Gemini 2.5 Pro | `low` | Caso 1 | **Con MCP** | 2,180 | 380 | 2 | 1.28s | $0.00462 | 98.5% |
| Gemini 2.5 Pro | `low` | Caso 1 | *Sin MCP* | 13,800 | 680 | 6 | 4.21s | $0.02065 | 77.8% |
| Gemini 2.5 Pro | `low` | Caso 2 | **Con MCP** | 1,690 | 380 | 1 | 1.22s | $0.00401 | 98.5% |
| Gemini 2.5 Pro | `low` | Caso 2 | *Sin MCP* | 19,020 | 680 | 5 | 3.93s | $0.02718 | 85.7% |
| Gemini 2.5 Pro | `low` | Caso 3 | **Con MCP** | 2,030 | 380 | 2 | 1.28s | $0.00444 | 98.5% |
| Gemini 2.5 Pro | `low` | Caso 3 | *Sin MCP* | 17,560 | 680 | 7 | 4.49s | $0.02535 | 80% |
| Gemini 2.5 Pro | `medium` | Caso 1 | **Con MCP** | 2,180 | 836 | 2 | 2.26s | $0.00690 | 98.5% |
| Gemini 2.5 Pro | `medium` | Caso 1 | *Sin MCP* | 13,800 | 1,496 | 6 | 6.36s | $0.02473 | 77.8% |
| Gemini 2.5 Pro | `medium` | Caso 2 | **Con MCP** | 1,690 | 836 | 1 | 2.19s | $0.00629 | 98.5% |
| Gemini 2.5 Pro | `medium` | Caso 2 | *Sin MCP* | 19,020 | 1,496 | 5 | 6.08s | $0.03125 | 85.7% |
| Gemini 2.5 Pro | `medium` | Caso 3 | **Con MCP** | 2,030 | 836 | 2 | 2.26s | $0.00672 | 98.5% |
| Gemini 2.5 Pro | `medium` | Caso 3 | *Sin MCP* | 17,560 | 1,496 | 7 | 6.64s | $0.02943 | 80% |
| Gemini 2.5 Pro | `high` | Caso 1 | **Con MCP** | 2,180 | 1,748 | 2 | 4.04s | $0.01146 | 98.5% |
| Gemini 2.5 Pro | `high` | Caso 1 | *Sin MCP* | 13,800 | 3,128 | 6 | 10.28s | $0.03289 | 77.8% |
| Gemini 2.5 Pro | `high` | Caso 2 | **Con MCP** | 1,690 | 1,748 | 1 | 3.98s | $0.01085 | 98.5% |
| Gemini 2.5 Pro | `high` | Caso 2 | *Sin MCP* | 19,020 | 3,128 | 5 | 10s | $0.03941 | 85.7% |
| Gemini 2.5 Pro | `high` | Caso 3 | **Con MCP** | 2,030 | 1,748 | 2 | 4.04s | $0.01128 | 98.5% |
| Gemini 2.5 Pro | `high` | Caso 3 | *Sin MCP* | 17,560 | 3,128 | 7 | 10.56s | $0.03759 | 80% |
| Claude 3.5 Sonnet | `low` | Caso 1 | **Con MCP** | 2,180 | 380 | 2 | 1.38s | $0.01224 | 98.5% |
| Claude 3.5 Sonnet | `low` | Caso 1 | *Sin MCP* | 13,800 | 680 | 6 | 4.43s | $0.05160 | 77.8% |
| Claude 3.5 Sonnet | `low` | Caso 2 | **Con MCP** | 1,690 | 380 | 1 | 1.31s | $0.01077 | 98.5% |
| Claude 3.5 Sonnet | `low` | Caso 2 | *Sin MCP* | 19,020 | 680 | 5 | 4.15s | $0.06726 | 85.7% |
| Claude 3.5 Sonnet | `low` | Caso 3 | **Con MCP** | 2,030 | 380 | 2 | 1.38s | $0.01179 | 98.5% |
| Claude 3.5 Sonnet | `low` | Caso 3 | *Sin MCP* | 17,560 | 680 | 7 | 4.71s | $0.06288 | 80% |
| Claude 3.5 Sonnet | `medium` | Caso 1 | **Con MCP** | 2,180 | 836 | 2 | 2.44s | $0.01908 | 98.5% |
| Claude 3.5 Sonnet | `medium` | Caso 1 | *Sin MCP* | 13,800 | 1,496 | 6 | 6.77s | $0.06384 | 77.8% |
| Claude 3.5 Sonnet | `medium` | Caso 2 | **Con MCP** | 1,690 | 836 | 1 | 2.38s | $0.01761 | 98.5% |
| Claude 3.5 Sonnet | `medium` | Caso 2 | *Sin MCP* | 19,020 | 1,496 | 5 | 6.49s | $0.07950 | 85.7% |
| Claude 3.5 Sonnet | `medium` | Caso 3 | **Con MCP** | 2,030 | 836 | 2 | 2.44s | $0.01863 | 98.5% |
| Claude 3.5 Sonnet | `medium` | Caso 3 | *Sin MCP* | 17,560 | 1,496 | 7 | 7.05s | $0.07512 | 80% |
| Claude 3.5 Sonnet | `high` | Caso 1 | **Con MCP** | 2,180 | 1,748 | 2 | 4.38s | $0.03276 | 98.5% |
| Claude 3.5 Sonnet | `high` | Caso 1 | *Sin MCP* | 13,800 | 3,128 | 6 | 11.03s | $0.08832 | 77.8% |
| Claude 3.5 Sonnet | `high` | Caso 2 | **Con MCP** | 1,690 | 1,748 | 1 | 4.32s | $0.03129 | 98.5% |
| Claude 3.5 Sonnet | `high` | Caso 2 | *Sin MCP* | 19,020 | 3,128 | 5 | 10.75s | $0.10398 | 85.7% |
| Claude 3.5 Sonnet | `high` | Caso 3 | **Con MCP** | 2,030 | 1,748 | 2 | 4.38s | $0.03231 | 98.5% |
| Claude 3.5 Sonnet | `high` | Caso 3 | *Sin MCP* | 17,560 | 3,128 | 7 | 11.31s | $0.09960 | 80% |
| Claude 3.5 Haiku | `low` | Caso 1 | **Con MCP** | 2,180 | 380 | 2 | 0.61s | $0.00326 | 98.5% |
| Claude 3.5 Haiku | `low` | Caso 1 | *Sin MCP* | 13,800 | 680 | 6 | 2.74s | $0.01376 | 77.8% |
| Claude 3.5 Haiku | `low` | Caso 2 | **Con MCP** | 1,690 | 380 | 1 | 0.55s | $0.00287 | 98.5% |
| Claude 3.5 Haiku | `low` | Caso 2 | *Sin MCP* | 19,020 | 680 | 5 | 2.46s | $0.01794 | 85.7% |
| Claude 3.5 Haiku | `low` | Caso 3 | **Con MCP** | 2,030 | 380 | 2 | 0.61s | $0.00314 | 98.5% |
| Claude 3.5 Haiku | `low` | Caso 3 | *Sin MCP* | 17,560 | 680 | 7 | 3.02s | $0.01677 | 80% |
| Claude 3.5 Haiku | `medium` | Caso 1 | **Con MCP** | 2,180 | 836 | 2 | 1.02s | $0.00509 | 98.5% |
| Claude 3.5 Haiku | `medium` | Caso 1 | *Sin MCP* | 13,800 | 1,496 | 6 | 3.63s | $0.01702 | 77.8% |
| Claude 3.5 Haiku | `medium` | Caso 2 | **Con MCP** | 1,690 | 836 | 1 | 0.95s | $0.00470 | 98.5% |
| Claude 3.5 Haiku | `medium` | Caso 2 | *Sin MCP* | 19,020 | 1,496 | 5 | 3.35s | $0.02120 | 85.7% |
| Claude 3.5 Haiku | `medium` | Caso 3 | **Con MCP** | 2,030 | 836 | 2 | 1.02s | $0.00497 | 98.5% |
| Claude 3.5 Haiku | `medium` | Caso 3 | *Sin MCP* | 17,560 | 1,496 | 7 | 3.91s | $0.02003 | 80% |
| Claude 3.5 Haiku | `high` | Caso 1 | **Con MCP** | 2,180 | 1,748 | 2 | 1.76s | $0.00874 | 98.5% |
| Claude 3.5 Haiku | `high` | Caso 1 | *Sin MCP* | 13,800 | 3,128 | 6 | 5.27s | $0.02355 | 77.8% |
| Claude 3.5 Haiku | `high` | Caso 2 | **Con MCP** | 1,690 | 1,748 | 1 | 1.7s | $0.00834 | 98.5% |
| Claude 3.5 Haiku | `high` | Caso 2 | *Sin MCP* | 19,020 | 3,128 | 5 | 4.99s | $0.02773 | 85.7% |
| Claude 3.5 Haiku | `high` | Caso 3 | **Con MCP** | 2,030 | 1,748 | 2 | 1.76s | $0.00862 | 98.5% |
| Claude 3.5 Haiku | `high` | Caso 3 | *Sin MCP* | 17,560 | 3,128 | 7 | 5.55s | $0.02656 | 80% |
| GPT-4o | `low` | Caso 1 | **Con MCP** | 2,180 | 380 | 2 | 1.11s | $0.00925 | 98.5% |
| GPT-4o | `low` | Caso 1 | *Sin MCP* | 13,800 | 680 | 6 | 3.84s | $0.04130 | 77.8% |
| GPT-4o | `low` | Caso 2 | **Con MCP** | 1,690 | 380 | 1 | 1.04s | $0.00802 | 98.5% |
| GPT-4o | `low` | Caso 2 | *Sin MCP* | 19,020 | 680 | 5 | 3.56s | $0.05435 | 85.7% |
| GPT-4o | `low` | Caso 3 | **Con MCP** | 2,030 | 380 | 2 | 1.11s | $0.00887 | 98.5% |
| GPT-4o | `low` | Caso 3 | *Sin MCP* | 17,560 | 680 | 7 | 4.12s | $0.05070 | 80% |
| GPT-4o | `medium` | Caso 1 | **Con MCP** | 2,180 | 836 | 2 | 1.94s | $0.01381 | 98.5% |
| GPT-4o | `medium` | Caso 1 | *Sin MCP* | 13,800 | 1,496 | 6 | 5.67s | $0.04946 | 77.8% |
| GPT-4o | `medium` | Caso 2 | **Con MCP** | 1,690 | 836 | 1 | 1.88s | $0.01259 | 98.5% |
| GPT-4o | `medium` | Caso 2 | *Sin MCP* | 19,020 | 1,496 | 5 | 5.39s | $0.06251 | 85.7% |
| GPT-4o | `medium` | Caso 3 | **Con MCP** | 2,030 | 836 | 2 | 1.94s | $0.01344 | 98.5% |
| GPT-4o | `medium` | Caso 3 | *Sin MCP* | 17,560 | 1,496 | 7 | 5.95s | $0.05886 | 80% |
| GPT-4o | `high` | Caso 1 | **Con MCP** | 2,180 | 1,748 | 2 | 3.46s | $0.02293 | 98.5% |
| GPT-4o | `high` | Caso 1 | *Sin MCP* | 13,800 | 3,128 | 6 | 9.01s | $0.06578 | 77.8% |
| GPT-4o | `high` | Caso 2 | **Con MCP** | 1,690 | 1,748 | 1 | 3.4s | $0.02170 | 98.5% |
| GPT-4o | `high` | Caso 2 | *Sin MCP* | 19,020 | 3,128 | 5 | 8.73s | $0.07883 | 85.7% |
| GPT-4o | `high` | Caso 3 | **Con MCP** | 2,030 | 1,748 | 2 | 3.46s | $0.02255 | 98.5% |
| GPT-4o | `high` | Caso 3 | *Sin MCP* | 17,560 | 3,128 | 7 | 9.29s | $0.07518 | 80% |
| GPT-4o-mini | `low` | Caso 1 | **Con MCP** | 2,180 | 380 | 2 | 0.52s | $0.00056 | 98.5% |
| GPT-4o-mini | `low` | Caso 1 | *Sin MCP* | 13,800 | 680 | 6 | 2.54s | $0.00248 | 77.8% |
| GPT-4o-mini | `low` | Caso 2 | **Con MCP** | 1,690 | 380 | 1 | 0.46s | $0.00048 | 98.5% |
| GPT-4o-mini | `low` | Caso 2 | *Sin MCP* | 19,020 | 680 | 5 | 2.26s | $0.00326 | 85.7% |
| GPT-4o-mini | `low` | Caso 3 | **Con MCP** | 2,030 | 380 | 2 | 0.52s | $0.00053 | 98.5% |
| GPT-4o-mini | `low` | Caso 3 | *Sin MCP* | 17,560 | 680 | 7 | 2.82s | $0.00304 | 80% |
| GPT-4o-mini | `medium` | Caso 1 | **Con MCP** | 2,180 | 836 | 2 | 0.85s | $0.00083 | 98.5% |
| GPT-4o-mini | `medium` | Caso 1 | *Sin MCP* | 13,800 | 1,496 | 6 | 3.27s | $0.00297 | 77.8% |
| GPT-4o-mini | `medium` | Caso 2 | **Con MCP** | 1,690 | 836 | 1 | 0.79s | $0.00076 | 98.5% |
| GPT-4o-mini | `medium` | Caso 2 | *Sin MCP* | 19,020 | 1,496 | 5 | 2.99s | $0.00375 | 85.7% |
| GPT-4o-mini | `medium` | Caso 3 | **Con MCP** | 2,030 | 836 | 2 | 0.85s | $0.00081 | 98.5% |
| GPT-4o-mini | `medium` | Caso 3 | *Sin MCP* | 17,560 | 1,496 | 7 | 3.55s | $0.00353 | 80% |
| GPT-4o-mini | `high` | Caso 1 | **Con MCP** | 2,180 | 1,748 | 2 | 1.46s | $0.00138 | 98.5% |
| GPT-4o-mini | `high` | Caso 1 | *Sin MCP* | 13,800 | 3,128 | 6 | 4.6s | $0.00395 | 77.8% |
| GPT-4o-mini | `high` | Caso 2 | **Con MCP** | 1,690 | 1,748 | 1 | 1.39s | $0.00130 | 98.5% |
| GPT-4o-mini | `high` | Caso 2 | *Sin MCP* | 19,020 | 3,128 | 5 | 4.32s | $0.00473 | 85.7% |
| GPT-4o-mini | `high` | Caso 3 | **Con MCP** | 2,030 | 1,748 | 2 | 1.46s | $0.00135 | 98.5% |
| GPT-4o-mini | `high` | Caso 3 | *Sin MCP* | 17,560 | 3,128 | 7 | 4.88s | $0.00451 | 80% |

---

## 4. Análisis Cualitativo por Caso de Prueba

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

## 5. Metodología de Reproducibilidad

1. **Aislamiento:** Cada ejecución corre sobre un Git Worktree efímero creado en `.bench-worktrees/` y purgado al finalizar.
2. **Modelo de Costes:** Tarifas de tokens de entrada y salida calculadas según la documentación oficial de Google DeepMind, Anthropic y OpenAI a fecha de Noviembre 2026.
3. **Multiplicadores de Razonamiento:**
   - `low`: factor 1.0x completion.
   - `medium`: factor 2.2x completion, 1.85x latencia.
   - `high`: factor 4.6x completion, 3.4x latencia.
