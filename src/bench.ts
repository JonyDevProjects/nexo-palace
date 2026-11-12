/**
 * Comparativa de proveedores de embeddings del Nexo-Palace Engine.
 *
 * Construye un índice independiente por proveedor (en su propia base SQLite) y
 * lanza el mismo conjunto de consultas contra cada uno, para comparar:
 *   * calidad de la recuperación (qué documento devuelve y en qué posición);
 *   * tiempo de indexación;
 *   * latencia por consulta.
 *
 *   node --experimental-strip-types scripts/palace-engine/bench.ts
 */
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { dbPath as defaultDbPath, loadEnv, projectRoot } from "./config.ts";
import { closeDb, indexProvider, indexStats, openDb } from "./db.ts";
import { createEmbeddingProvider, providerFromId } from "./embedder.ts";
import { extractCode } from "./extract-code.ts";
import { ingestDocuments } from "./ingest-docs.ts";
import { search } from "./query.ts";

/** Un proveedor a comparar. */
interface BenchProvider {
  id: string;
  label: string;
  /** Opciones para construir el proveedor. */
  options: { provider: string; model?: string };
  /** Si el proveedor es local y no depende de la API. */
  local: boolean;
}

/** Consultas de prueba con el documento que se espera encontrar. */
const QUERIES: Array<{ query: string; expect: string; note: string }> = [
  {
    query: "criterios de aceptación WCAG",
    expect: "review_accessibility_wcag.md",
    note: "Literal + semántico",
  },
  {
    query: "skip navigation link bypass keyboard focus trap modal",
    expect: "review_accessibility_wcag.md",
    note: "Hallazgos concretos del review",
  },
  {
    query: "cómo se manejan los errores cuando el usuario no está autenticado",
    expect: "audit_report.md",
    note: "Paráfrasis sin vocabulario literal",
  },
  {
    query: "compresión WebP de las fotos de los platos en el navegador",
    expect: "especificacion_backlog_v1.1.md",
    note: "Paráfrasis de una épica",
  },
  {
    query: "filtrado de alérgenos en la carta pública",
    expect: "allergens",
    note: "Paráfrasis de funcionalidad",
  },
  {
    query: "persistencia en disco y renombrado atómico del caché",
    expect: "localStore",
    note: "Módulo de código",
  },
  {
    query: "requisitos no funcionales y rendimiento móvil",
    expect: "especificacion_backlog_v1.1.md",
    note: "Sección de especificación",
  },
  {
    query: "EPC-02",
    expect: "epc-02",
    note: "Identificador exacto",
  },
];

/** Proveedores a comparar. */
const PROVIDERS: BenchProvider[] = [
  {
    id: "litert",
    label: "LiteRT local (nomic-embed-text, 768d)",
    options: { provider: "litert" },
    local: true,
  },
  {
    id: "gemini2",
    label: "Gemini Embedding 2 preview (768d)",
    options: { provider: "gemini", model: "gemini-embedding-2-preview" },
    local: false,
  },
  {
    id: "offline",
    label: "Offline hash-TF-IDF (384d, léxico)",
    options: { provider: "offline" },
    local: true,
  },
];

/** Resultado de una consulta contra un proveedor. */
interface QueryOutcome {
  query: string;
  expect: string;
  note: string;
  hits: string[];
  found: boolean;
  rank: number | null;
  latencyMs: number;
}

/** Comprueba si un camino contiene el texto esperado (sin distinguir mayúsculas). */
function matches(path: string | null, expect: string): boolean {
  if (!path) return false;
  return path.toLowerCase().includes(expect.toLowerCase());
}

async function main(): Promise<void> {
  loadEnv();

  const results: Array<{
    provider: BenchProvider;
    indexSeconds: number;
    outcomes: QueryOutcome[];
    vectorOutcomes: QueryOutcome[];
    reused: boolean;
  }> = [];

  for (const bench of PROVIDERS) {
    const dbPath = join(dirname(defaultDbPath()), `bench-${bench.id}.sqlite3`);
    const reuse = process.argv.includes("--reuse");

    process.stderr.write(`\n[bench] ${bench.label}\n`);

    let provider;
    try {
      provider = await createEmbeddingProvider(bench.options);
    } catch (err) {
      process.stderr.write(`[bench] no disponible: ${(err as Error).message}\n`);
      continue;
    }

    const db = openDb(dbPath);
    let indexSeconds = 0;
    let reused = false;

    const existing = indexStats(db);
    if (reuse && existing.chunks > 0 && existing.vectors > 0) {
      reused = true;
      process.stderr.write(
        `[bench] índice reutilizado — ${existing.chunks} fragmentos, ${existing.vectors} vectores\n`,
      );
    } else {
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${dbPath}${suffix}`, { force: true });
      }
      closeDb();
      const fresh = openDb(dbPath);
      const t0 = Date.now();
      try {
        await ingestDocuments(provider, { db: fresh, allowProviderSwitch: true });
        await extractCode(provider, { db: fresh, allowProviderSwitch: true });
      } catch (err) {
        process.stderr.write(`[bench] fallo al indexar: ${(err as Error).message}\n`);
        closeDb();
        continue;
      }
      indexSeconds = (Date.now() - t0) / 1000;
    }

    const stats = indexStats(db);
    const outcomes: QueryOutcome[] = [];
    const vectorOutcomes: QueryOutcome[] = [];

    for (const item of QUERIES) {
      const queryProvider = providerFromId(indexProvider(db).id, indexProvider(db).dim) ?? provider;

      const run = async (mode: "hybrid" | "vector"): Promise<QueryOutcome> => {
        const t1 = Date.now();
        let hits: string[] = [];
        let reqIds: string[][] = [];
        try {
          const res = await search(item.query, queryProvider, { limit: 5, mode }, db);
          hits = res.map((r) => r.path ?? r.nodeId);
          reqIds = res.map((r) => r.requirementIds);
        } catch {
          hits = [];
        }
        const latencyMs = Date.now() - t1;
        const rank = hits.findIndex((h, i) => matches(h, item.expect) ||
          reqIds[i].some((id) => id.toUpperCase().includes(item.expect.toUpperCase())));
        return {
          query: item.query,
          expect: item.expect,
          note: item.note,
          hits,
          found: rank !== -1,
          rank: rank === -1 ? null : rank + 1,
          latencyMs,
        };
      };

      outcomes.push(await run("hybrid"));
      vectorOutcomes.push(await run("vector"));
    }

    closeDb();
    results.push({ provider: bench, indexSeconds, outcomes, vectorOutcomes, reused });
    process.stderr.write(
      `[bench] ${reused ? "reutilizado" : `indexado en ${indexSeconds.toFixed(1)}s`} — ` +
        `${stats.chunks} fragmentos, ${stats.vectors} vectores (dim ${stats.dim})\n`,
    );
  }

  // --- Informe -------------------------------------------------------------
  process.stdout.write("\n=== COMPARATIVA DE PROVEEDORES DE EMBEDDINGS ===\n");

  for (const { provider, indexSeconds, outcomes, vectorOutcomes, reused } of results) {
    const found = outcomes.filter((o) => o.found).length;
    const top1 = outcomes.filter((o) => o.rank === 1).length;
    const avgLatency =
      outcomes.reduce((acc, o) => acc + o.latencyMs, 0) / Math.max(outcomes.length, 1);
    const vTop1 = vectorOutcomes.filter((o) => o.rank === 1).length;
    const vFound = vectorOutcomes.filter((o) => o.found).length;

    process.stdout.write(
      `\n${provider.label}\n` +
        `  híbrido  — top-1: ${top1}/${outcomes.length} | top-5: ${found}/${outcomes.length}` +
        ` | latencia ${avgLatency.toFixed(0)} ms\n` +
        `  solo vector — top-1: ${vTop1}/${vectorOutcomes.length} | top-5: ${vFound}/${vectorOutcomes.length}\n` +
        `  indexación: ${reused ? "reutilizado" : `${indexSeconds.toFixed(1)}s`}\n`,
    );

    for (const o of outcomes) {
      const mark = o.found ? (o.rank === 1 ? "1" : String(o.rank)) : "-";
      const v = vectorOutcomes.find((x) => x.query === o.query);
      const vMark = v?.found ? (v.rank === 1 ? "1" : String(v.rank)) : "-";
      process.stdout.write(
        `   [${mark.padStart(2)}|v${vMark.padStart(2)}] ${o.query}\n` +
          `         top: ${o.hits.slice(0, 3).join(" | ") || "(sin resultados)"}\n` +
          `         vec: ${v?.hits.slice(0, 2).join(" | ") || "(sin resultados)"}\n`,
      );
    }
  }

  // --- Tabla resumen -------------------------------------------------------
  if (results.length > 0) {
    process.stdout.write("\n--- Resumen (híbrido | solo vector) ---\n");
    process.stdout.write(
      ["proveedor".padEnd(44), "top-1".padStart(7), "top-5".padStart(7), "v-top1".padStart(8), "v-top5".padStart(8), "índice".padStart(9), "consulta".padStart(10)].join("") +
        "\n",
    );
    for (const { provider, indexSeconds, outcomes, vectorOutcomes, reused } of results) {
      const found = outcomes.filter((o) => o.found).length;
      const top1 = outcomes.filter((o) => o.rank === 1).length;
      const vTop1 = vectorOutcomes.filter((o) => o.rank === 1).length;
      const vFound = vectorOutcomes.filter((o) => o.found).length;
      const avgLatency =
        outcomes.reduce((acc, o) => acc + o.latencyMs, 0) / Math.max(outcomes.length, 1);
      process.stdout.write(
        provider.label.padEnd(44) +
          `${top1}/${outcomes.length}`.padStart(7) +
          `${found}/${outcomes.length}`.padStart(7) +
          `${vTop1}/${vectorOutcomes.length}`.padStart(8) +
          `${vFound}/${vectorOutcomes.length}`.padStart(8) +
          `${reused ? "reutil." : `${indexSeconds.toFixed(1)}s`}`.padStart(9) +
          `${avgLatency.toFixed(0)}ms`.padStart(10) +
          "\n",
      );
    }
  }

  process.stdout.write(
    `\nBases de la comparativa en ${dirname(defaultDbPath())} (bench-*.sqlite3)\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  });
