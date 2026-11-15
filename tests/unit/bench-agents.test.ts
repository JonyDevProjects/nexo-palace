import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CASES,
  EFFORT_MULTIPLIERS,
  EVALUATION_MODELS,
  AgentBenchmarkRunner,
  generateMarkdownReport,
  parseCliArgs,
  WorktreeHarness,
  type ComparativeSummary,
} from "../../scripts/bench-agents.ts";

describe("P5 Agent Benchmark Suite", () => {
  describe("Model profiles and pricing", () => {
    it("debe contener perfiles para las tres familias: Google, Anthropic y OpenAI", () => {
      const families = new Set(Object.values(EVALUATION_MODELS).map((m) => m.family));
      expect(families.has("Google")).toBe(true);
      expect(families.has("Anthropic")).toBe(true);
      expect(families.has("OpenAI")).toBe(true);
    });

    it("debe incluir los modelos especificados en docs/specs/P5-benchmark.md", () => {
      expect(EVALUATION_MODELS["gemini-2.5-flash"]).toBeDefined();
      expect(EVALUATION_MODELS["gemini-2.5-pro"]).toBeDefined();
      expect(EVALUATION_MODELS["claude-3.5-sonnet"]).toBeDefined();
      expect(EVALUATION_MODELS["claude-3.5-haiku"]).toBeDefined();
      expect(EVALUATION_MODELS["gpt-4o"]).toBeDefined();
      expect(EVALUATION_MODELS["gpt-4o-mini"]).toBeDefined();
    });

    it("las tarifas de coste deben ser estrictamente positivas", () => {
      for (const model of Object.values(EVALUATION_MODELS)) {
        expect(model.inputCostPerMillion).toBeGreaterThan(0);
        expect(model.outputCostPerMillion).toBeGreaterThan(0);
        expect(model.baseLatencyMs).toBeGreaterThan(0);
      }
    });
  });

  describe("Reasoning effort multipliers", () => {
    it("debe contemplar niveles low, medium y high con progresión monotónica", () => {
      expect(EFFORT_MULTIPLIERS.low.completionMult).toBe(1.0);
      expect(EFFORT_MULTIPLIERS.medium.completionMult).toBeGreaterThan(EFFORT_MULTIPLIERS.low.completionMult);
      expect(EFFORT_MULTIPLIERS.high.completionMult).toBeGreaterThan(EFFORT_MULTIPLIERS.medium.completionMult);
    });
  });

  describe("Batería de casos de prueba (P5)", () => {
    it("debe contener exactamente los 3 casos descritos en la especificación", () => {
      expect(BENCHMARK_CASES).toHaveLength(3);
      expect(BENCHMARK_CASES.map((c) => c.id)).toEqual([1, 2, 3]);
    });

    it("Caso 1: debe cubrir consulta de requisitos y decisiones (drift y litert/ollama)", () => {
      const case1 = BENCHMARK_CASES.find((c) => c.id === 1)!;
      expect(case1.expectedToolCallsMcp).toContain("memory_query");
      expect(case1.prompts.some((p) => p.includes("drift"))).toBe(true);
      expect(case1.prompts.some((p) => p.includes("LiteRT") || p.includes("Ollama"))).toBe(true);
      expect(case1.groundTruthKeywords).toContain("drift");
      expect(case1.groundTruthKeywords).toContain("litert");
    });

    it("Caso 2: debe cubrir trazabilidad cruzada de src/installer.ts", () => {
      const case2 = BENCHMARK_CASES.find((c) => c.id === 2)!;
      expect(case2.expectedToolCallsMcp).toContain("memory_trace");
      expect(case2.prompts[0]).toContain("src/installer.ts");
      expect(case2.groundTruthKeywords).toContain("tests/unit/installer.test.ts");
      expect(case2.groundTruthKeywords).toContain("registerAntigravity");
    });

    it("Caso 3: debe cubrir evaluación de impacto previo a refactor de src/server.ts", () => {
      const case3 = BENCHMARK_CASES.find((c) => c.id === 3)!;
      expect(case3.expectedToolCallsMcp).toContain("memory_trace");
      expect(case3.expectedToolCallsMcp).toContain("memory_query");
      expect(case3.prompts[0]).toContain("src/server.ts");
      expect(case3.groundTruthKeywords).toContain("src/server.ts");
      expect(case3.groundTruthKeywords).toContain("AGENTS.md");
    });
  });

  describe("AgentBenchmarkRunner", () => {
    const runner = new AgentBenchmarkRunner(process.cwd(), "emulated");
    const testModel = EVALUATION_MODELS["gemini-2.5-flash"];
    const testCase = BENCHMARK_CASES[0];

    it("ejecución con MCP debe consumir significativamente menos tokens que sin MCP", () => {
      const withMcp = runner.runBenchmark(testCase, testModel, "low", "with-mcp", process.cwd());
      const withoutMcp = runner.runBenchmark(testCase, testModel, "low", "without-mcp", process.cwd());

      expect(withMcp.totalTokens).toBeLessThan(withoutMcp.totalTokens);
      expect(withMcp.toolCalls).toBeLessThan(withoutMcp.toolCalls);
      expect(withMcp.estimatedCostUsd).toBeLessThan(withoutMcp.estimatedCostUsd);
      expect(withMcp.precisionPercent).toBeGreaterThanOrEqual(withoutMcp.precisionPercent);
      expect(withMcp.scenario).toBe("with-mcp");
      expect(withoutMcp.scenario).toBe("without-mcp");
    });

    it("el incremento de reasoning effort debe reflejarse en tokens de salida y latencia", () => {
      const low = runner.runBenchmark(testCase, testModel, "low", "with-mcp", process.cwd());
      const high = runner.runBenchmark(testCase, testModel, "high", "with-mcp", process.cwd());

      expect(high.completionTokens).toBeGreaterThan(low.completionTokens);
      expect(high.latencySeconds).toBeGreaterThan(low.latencySeconds);
    });
  });

  describe("CLI Options Parser", () => {
    it("debe parsear argumentos estándar y aplicar valores por defecto", () => {
      const defaults = parseCliArgs([]);
      expect(defaults.models).toContain("gemini-2.5-flash");
      expect(defaults.efforts).toEqual(["low", "medium", "high"]);
      expect(defaults.cases).toEqual([1, 2, 3]);
      expect(defaults.mode).toBe("auto");
      expect(defaults.dryRun).toBe(false);
    });

    it("debe admitir filtros específicos por modelo, esfuerzo y flags", () => {
      const custom = parseCliArgs([
        "--models=gpt-4o,claude-3.5-haiku",
        "--efforts=medium",
        "--cases=2",
        "--mode=emulated",
        "--dry-run",
        "--json",
      ]);
      expect(custom.models).toEqual(["gpt-4o", "claude-3.5-haiku"]);
      expect(custom.efforts).toEqual(["medium"]);
      expect(custom.cases).toEqual([2]);
      expect(custom.mode).toBe("emulated");
      expect(custom.dryRun).toBe(true);
      expect(custom.json).toBe(true);
    });
  });

  describe("Generador de Informes Markdown", () => {
    it("debe generar un informe con tablas comparativas y alertas estructuradas", () => {
      const runner = new AgentBenchmarkRunner(process.cwd(), "emulated");
      const model = EVALUATION_MODELS["gemini-2.5-flash"];
      const testCase = BENCHMARK_CASES[0];

      const withMcp = runner.runBenchmark(testCase, model, "low", "with-mcp", process.cwd());
      const withoutMcp = runner.runBenchmark(testCase, model, "low", "without-mcp", process.cwd());

      const comparison: ComparativeSummary = {
        modelId: model.id,
        effort: "low",
        caseId: testCase.id,
        withMcp,
        withoutMcp,
        tokenReductionPercent: 82.5,
        costReductionPercent: 78.2,
        toolCallsReductionPercent: 66.7,
        latencyReductionPercent: 70.0,
        precisionDelta: 15.0,
      };

      const md = generateMarkdownReport([comparison], [model], ["low"], [testCase], "emulated");
      expect(md).toContain("# Informe de Benchmarking: Eficiencia y Costes de Agentes (P5)");
      expect(md).toContain("Con Nexo-Palace MCP");
      expect(md).toContain("Sin MCP (Lectura Lineal)");
      expect(md).toContain("Caso 1: Consulta de Requisitos y Decisiones");
      expect(md).toContain("Gemini 2.5 Flash");
    });
  });

  describe("WorktreeHarness", () => {
    it("debe instanciarse correctamente con la raíz del proyecto", () => {
      const harness = new WorktreeHarness(process.cwd());
      expect(harness).toBeDefined();
    });
  });
});
