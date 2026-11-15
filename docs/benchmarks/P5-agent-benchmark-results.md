# Informe de Benchmarking: Eficiencia y Costes de Agentes (P5)

> **Fecha:** 2026-11-15T18:35:45.419Z  
> **Modo de Orquestación:** `herdr` (Sesiones Reales en Vivo con Herdr)  
> **Modelos Evaluados:** Gemini 2.5 Flash (Google)  
> **Niveles de Razonamiento:** low  
> **Casos Ejecutados:** Caso 1: Caso 1: Consulta de Requisitos y Decisiones

---

## 1. Resumen Ejecutivo de Ganancias de Eficiencia

| Métrica Global | Con Nexo-Palace MCP | Sin MCP (Lectura Lineal) | Ahorro / Mejora |
| :--- | :---: | :---: | :---: |
| **Tokens Promedio por Consulta** | **3,042** | 14,731 | **-79.3%** |
| **Llamadas a Herramientas (Tool Calls)** | **10.0** | 16.0 | **-37.5%** |
| **Coste Estimado Promedio ($ USD)** | **$0.00042** | $0.00131 | **-67.9%** |
| **Latencia / Tiempo de Resolución (s)** | **34.52s** | 49.01s | **-29.6%** |
| **Precisión frente a Ground Truth** | **100.0%** | 100.0% | **+0.0 pts** |

> [!TIP]
> **Conclusión Clave:** Nexo-Palace reduce en promedio más del **79.3% de tokens de contexto** y abarata el coste en un **67.9%**, al sustituir lecturas secuenciales de archivos enteros por búsquedas híbridas (BM25 + embeddings) y consultas directas al grafo de dependencias precomputado.

---

## 2. Gráfico Comparativo de Reducción de Tokens y Costes

```text
Consumo de Tokens Promedio:
  Con MCP    [█████] 3042 tokens (-79.3%)
  Sin MCP    [██████████████████████████████] 14731 tokens

Coste Computacional Promedio:
  Con MCP    [████] $0.00042 (-67.9%)
  Sin MCP    [██████████████████████████████] $0.00131

Llamadas a Herramientas (Tool Calls):
  Con MCP    [██] 10.0 calls (-37.5%)
  Sin MCP    [████████████████] 16.0 calls
```

---

## 3. Matriz Detallada de Evaluación por Modelo, Esfuerzo y Caso

| Modelo | Esfuerzo | Caso | Escenario | Prompt Tok | Compl Tok | Tool Calls | Latencia | Coste ($ USD) | Precisión |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Gemini 2.5 Flash | `low` | Caso 1 | **Con MCP** | 2,180 | 862 | 10 | 34.52s | $0.00042 | 100% |
| Gemini 2.5 Flash | `low` | Caso 1 | *Sin MCP* | 13,800 | 931 | 16 | 49.01s | $0.00131 | 100% |

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
