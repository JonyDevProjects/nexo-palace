#!/usr/bin/env node
/**
 * Nexo-Palace — CLI.
 *
 * Uso:
 *   nexo-palace index [--provider litert|gemini|ollama|offline] [--model <modelo>] [--best-effort]
 *   nexo-palace query "<texto>" [--scope doc|code|test|taste|requirement|all] [--limit N]
 *   nexo-palace trace "<ruta o símbolo>" [--depth N]
 *   nexo-palace drift [--base <ref>] [--dry-run] [--strict]
 *   nexo-palace decide --context <texto> --decision <texto> [--tags a,b] [--files x,y]
 *   nexo-palace stats
 *   nexo-palace serve
 *   nexo-palace init-agent [--harness <all|antigravity|cursor|claude|copilot>] [--dry-run]
 *
 * Opciones globales (antes o después del subcomando):
 *   --root <dir>      Raíz del proyecto a indexar.
 *   --config <file>   Fichero `nexo-palace.config.json` explícito.
 *
 * El mismo motor se expone como servidor MCP en `server.ts`.
 */
import { closeDb, indexProvider, indexStats, openDb } from "./db.ts";
import { getConfig, initProject, loadEnv, OFFLINE_EMBEDDING_DIM } from "./config.ts";
import {
  describeProvider,
  OfflineEmbeddingProvider,
  providerFromId,
  type EmbeddingProvider,
} from "./embedder.ts";
import { detectDrift } from "./drift.ts";
import { recordDecision } from "./episodes.ts";
import { runMap } from "./map.ts";
import { search } from "./query.ts";
import { traceEntity } from "./trace.ts";
import { startServer } from "./server.ts";
import { ProgressBar } from "./tui.ts";

/** Opciones analizadas de la línea de comandos. */
interface CliOptions {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** Divide los argumentos en posicionales y banderas. */
function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/**
 * Proveedor para las consultas: el mismo con el que se indexó.
 *
 * Si ese proveedor ya no está disponible (cuota agotada, Ollama apagado), la
 * capa vectorial queda desactivada —sus vectores no serían comparables— y la
 * búsqueda sigue siendo léxica.
 */
function queryProvider(db: ReturnType<typeof openDb>): EmbeddingProvider {
  const index = indexProvider(db);
  const fromIndex = providerFromId(index.id, index.dim);
  if (fromIndex) return fromIndex;

  process.stderr.write(
    "[nexo-palace] El índice no tiene capa vectorial o su proveedor no está disponible: " +
      "la búsqueda será solo léxica.\n",
  );
  return new OfflineEmbeddingProvider(index.dim ?? OFFLINE_EMBEDDING_DIM);
}

/** Imprime el uso del CLI. */
function usage(): void {
  process.stdout.write(
    [
      "Nexo-Palace — El Arquitecto del Sueño: memoria de proyecto para agentes",
      "",
      "Comandos:",
      "  map | index [--provider <litert|gemini|ollama|offline>] [--model <modelo>] [--best-effort]",
      "                                                                       El Arquitecto cartografía el repositorio y teje el grafo",
      "  query <texto> [--scope <scope>] [--limit <n>] [--path <prefijo>]    Consulta híbrida",
      "  trace <entidad> [--depth <n>]                                      Traza el grafo de un archivo o símbolo",
      "  drift [--base <ref>] [--dry-run] [--strict]                         Detecta deriva entre código y requisitos",
      "  decide --context <texto> --decision <texto> [--tags a,b] [--files x,y]",
      "                                                                       Registra una decisión en la memoria",
      "  stats                                                               Estado del índice",
      "  serve                                                               Servidor MCP por stdio",
      "  init-agent | init-rules [--harness <lista|all>] [--no-scripts] [--no-hooks] [--mcp] [--dry-run]",
      "                                                                       Genera reglas de agente, scripts npm y Git hooks",
      "  setup                                                               Asistente de instalación y configuración",
      "",
      "Opciones globales:",
      "  --root <dir>      Raíz del proyecto a indexar",
      "  --config <file>   Fichero nexo-palace.config.json explícito",
      "",
    ].join("\n"),
  );
}

/** Parsea `--harness` en una lista validada de harnesses. */
async function parseHarnessFlag(
  raw: string | boolean | undefined,
): Promise<Array<"antigravity" | "cursor" | "claude" | "copilot"> | undefined> {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const { HARNESS_IDS } = await import("./agent-integration.ts");
  const aliases: Record<string, (typeof HARNESS_IDS)[number]> = {
    agy: "antigravity",
    gemini: "antigravity",
    antigravity: "antigravity",
    cursor: "cursor",
    claude: "claude",
    "claude-code": "claude",
    copilot: "copilot",
    vscode: "copilot",
  };
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes("all")) return [...HARNESS_IDS];
  const resolved = parts.map((p) => {
    const mapped = aliases[p];
    if (!mapped) {
      throw new Error(`Harness desconocido '${p}'. Opciones válidas: all, ${HARNESS_IDS.join(", ")}`);
    }
    return mapped;
  });
  return [...new Set(resolved)];
}

/** Ejecuta el comando solicitado. */
async function main(): Promise<number> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  const explicitRoot = typeof flags.root === "string" ? flags.root : undefined;
  const explicitConfig = typeof flags.config === "string" ? flags.config : undefined;

  // La raíz del proyecto se resuelve antes que nada: de ella dependen el
  // `.env`, la base de datos y las rutas que se indexan.
  initProject({
    root: explicitRoot,
    config: explicitConfig,
  });
  loadEnv();

  if (!command || command === "help" || flags.help) {
    usage();
    return 0;
  }

  if (command === "setup") {
    const { main: runSetup } = await import("./installer.ts");
    await runSetup();
    return 0;
  }

  if (command === "init-agent" || command === "init-rules") {
    const { initAgentIntegration } = await import("./agent-integration.ts");
    const harnesses = await parseHarnessFlag(flags.harness);
    const root = getConfig().root;
    const dryRun = flags["dry-run"] === true;

    const report = initAgentIntegration(root, {
      harnesses,
      scripts: flags["no-scripts"] !== true,
      gitHooks: flags["no-hooks"] !== true,
      agentHooks: flags["no-agent-hooks"] !== true,
      strictHooks: flags["strict-hooks"] === true,
      force: flags.force === true,
      dryRun,
    });

    if (flags.mcp === true && !dryRun) {
      const { autoRegisterMcpClients, printMcpRegistrationReport } = await import("./installer.ts");
      const mcpReport = autoRegisterMcpClients(root);
      printMcpRegistrationReport(mcpReport);
    }

    process.stdout.write(
      [
        dryRun
          ? `[nexo-palace] Simulación (dry-run) de integración para ${report.projectName} (${report.projectRoot}):`
          : `✔ Integración de agentes configurada para ${report.projectName} (${report.projectRoot})`,
        `Harnesses: ${report.harnesses.join(", ")}`,
        `Comando base: ${report.palaceCommand}`,
        "Cambios:",
        ...report.changes.map(
          (c) => `  - [${c.action}] ${c.path}${c.reason ? ` — ${c.reason}` : ""}`,
        ),
        "",
      ].join("\n"),
    );
    return 0;
  }

  if (command === "serve") {
    const server = await startServer({
      root: explicitRoot,
      config: explicitConfig,
    });
    // Mantener vivo el proceso hasta que stdin se cierre o el servidor MCP termine.
    await new Promise<void>((resolve) => {
      const done = (): void => resolve();
      process.stdin.once("end", done);
      process.stdin.once("close", done);
      const prevOnClose = server.server.onclose;
      server.server.onclose = () => {
        prevOnClose?.();
        done();
      };
    });
    return 0;
  }

  const db = openDb();

  switch (command) {
    case "map":
    case "index": {
      const docBar = new ProgressBar(1, "Cartografiando documentos");
      const codeBar = new ProgressBar(1, "Parseando AST y dependencias");
      let docStarted = false;
      let codeStarted = false;

      const result = await runMap({
        db,
        provider: typeof flags.provider === "string" ? flags.provider : undefined,
        model: typeof flags.model === "string" ? flags.model : undefined,
        bestEffort: flags["best-effort"] === true,
        onDocProgress: (current, _total, file) => {
          if (!docStarted) {
            docStarted = true;
            process.stderr.write(`\n\x1b[1m\x1b[36m[arquitecto]\x1b[0m Cartografiando documentos...\n`);
          }
          docBar.update(current, file);
        },
        onCodeProgress: (current, _total, file) => {
          if (!codeStarted) {
            codeStarted = true;
            process.stderr.write(`\n\x1b[1m\x1b[36m[arquitecto]\x1b[0m Analizando código y tejiendo grafo de trazabilidad...\n`);
          }
          codeBar.update(current, file);
        },
      });

      if (result.skipped) {
        process.stderr.write(`[nexo-palace] Cartografía omitida (--best-effort): ${result.reason}\n`);
        return 0;
      }

      const docs = result.docs!;
      const code = result.code!;
      const stats = result.stats;
      if (docStarted) {
        docBar.finish(`Documentos cartografiados: ${docs.documents} (${docs.files} ficheros, ${docs.chunks} fragmentos)`);
      }
      if (codeStarted) {
        codeBar.finish(`Código analizado: ${code.files} ficheros, ${code.symbols} símbolos, ${code.tests} tests`);
      }

      process.stdout.write(
        "\n" +
          [
            `\x1b[1m\x1b[32m✔ Cartografía completada con éxito\x1b[0m`,
            `Proyecto: ${result.projectName} (${result.root})`,
            `Proveedor: ${result.provider ? describeProvider(result.provider) : "n/a"}`,
            `Requisitos detectados: ${docs.requirements}`,
            `Aristas del grafo: ${code.edges}`,
            `Vectores en memoria: ${stats.vectors} (dim ${stats.dim}, proveedor ${stats.provider})`,
            docs.skippedShort > 0
              ? `Fragmentos sin embedding por ser breves: ${docs.skippedShort}`
              : "",
            docs.errors.length > 0 ? `Errores: ${docs.errors.length}` : "",
            ...docs.errors.map((e) => `  - ${e}`),
          ]
            .filter(Boolean)
            .join("\n") +
          "\n\n",
      );
      return 0;
    }

    case "query": {
      const text = positional.slice(1).join(" ");
      if (!text) {
        process.stderr.write("Error: falta el texto de la consulta.\n");
        return 1;
      }
      const provider = queryProvider(db);
      const results = await search(
        text,
        provider,
        {
          scope: typeof flags.scope === "string" ? flags.scope : "all",
          limit: typeof flags.limit === "string" ? Number(flags.limit) : 8,
          pathPrefix: typeof flags.path === "string" ? flags.path : undefined,
        },
        db,
      );

      if (results.length === 0) {
        process.stdout.write("Sin resultados.\n");
        return 0;
      }

      for (const r of results) {
        process.stdout.write(
          [
            "",
            `=== ${r.path ?? r.nodeId} ${r.headerPath ? `[${r.headerPath}]` : ""}`,
            `    tipo=${r.nodeType} score=${r.score} lexico=${r.lexicalRank ?? "-"} vector=${r.vectorRank ?? "-"}${r.literal ? " literal" : ""}${r.requirementIds.length > 0 ? ` requisitos=${r.requirementIds.join(",")}` : ""}`,
            "",
            r.content,
          ].join("\n"),
        );
      }
      process.stdout.write("\n");
      return 0;
    }

    case "trace": {
      const entity = positional.slice(1).join(" ");
      if (!entity) {
        process.stderr.write("Error: falta la entidad a trazar.\n");
        return 1;
      }
      const trace = traceEntity(entity, typeof flags.depth === "string" ? Number(flags.depth) : 2, db);
      process.stdout.write(`${JSON.stringify(trace, null, 2)}\n`);
      return 0;
    }

    case "drift": {
      const result = detectDrift(
        {
          baseRef: typeof flags.base === "string" ? flags.base : undefined,
          mark: flags["dry-run"] !== true,
        },
        db,
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (flags.strict === true && result.events.length > 0) {
        return 1;
      }
      return 0;
    }

    case "decide": {
      const context = typeof flags.context === "string" ? flags.context : "";
      const decision = typeof flags.decision === "string" ? flags.decision : "";
      if (!context || !decision) {
        process.stderr.write("Error: `decide` requiere --context y --decision.\n");
        return 1;
      }
      const tags =
        typeof flags.tags === "string" ? flags.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
      const relatedFiles =
        typeof flags.files === "string"
          ? flags.files.split(",").map((f) => f.trim()).filter(Boolean)
          : [];

      const provider = queryProvider(db);
      const episode = await recordDecision({ context, decision, tags, relatedFiles }, db, provider);
      process.stdout.write(`${JSON.stringify(episode, null, 2)}\n`);
      return 0;
    }

    case "stats": {
      process.stdout.write(`${JSON.stringify(indexStats(db), null, 2)}\n`);
      return 0;
    }

    default:
      process.stderr.write(`Comando desconocido: ${command}\n\n`);
      usage();
      return 1;
  }
}

main()
  .then((code) => {
    closeDb();
    process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    closeDb();
    process.exit(1);
  });
