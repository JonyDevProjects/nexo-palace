/**
 * Prueba de humo del servidor MCP.
 *
 * Levanta el servidor como proceso hijo, se conecta con el cliente MCP y
 * comprueba que las herramientas responden. Es la verificación de que el
 * motor es consumible por un agente cualquiera, no solo por el CLI.
 *
 * La prueba es **autónoma**: crea su propio proyecto de fixture en un
 * directorio temporal, lo indexa y verifica el resultado contra ese corpus.
 * Así el paquete se puede probar en cualquier máquina, sin depender del
 * proyecto donde vive.
 *
 * Se comprueban los dos modos de superficie:
 *   * por defecto, la superficie completa;
 *   * con `PALACE_TOOLS=phase1`, solo búsqueda y estado.
 *
 *   node --experimental-strip-types src/test-mcp.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, openDb } from "./db.ts";
import { initProject, resetConfig } from "./config.ts";
import { extractCode } from "./extract-code.ts";
import { ingestDocuments } from "./ingest-docs.ts";
import { OfflineEmbeddingProvider } from "./embedder.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "server.ts");
const CLI = join(HERE, "cli.ts");

/** Ejecuta una comprobación y anota el resultado. */
let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  const mark = ok ? "OK  " : "FALLO";
  process.stdout.write(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) failures++;
}

/** Raíz del proyecto de fixture. */
let fixtureRoot = "";

/**
 * Crea el proyecto de fixture: un documento con un requisito, un fichero de
 * convenciones y un módulo de código con un import.
 */
function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "nexo-palace-test-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".commandcode", "taste"), { recursive: true });

  writeFileSync(
    join(root, "docs", "spec.md"),
    [
      "# Especificación de prueba",
      "",
      "## Requisito TSK-01: Recuperación híbrida",
      "",
      "El motor debe combinar la búsqueda semántica con la coincidencia literal.",
      "Los identificadores de trazabilidad tienen el formato TSK-01.",
      "",
      "## Requisito TSK-02: Trazabilidad",
      "",
      "Cada módulo debe poder trazar su origen documental.",
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(root, ".commandcode", "taste", "decisions.md"),
    [
      "# Decisiones",
      "",
      "## Convención del fixture",
      "",
      "- Los identificadores se normalizan en minúsculas.",
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(root, "src", "helper.ts"),
    [
      "/** Normaliza un identificador. */",
      "export function helper(id: string): string {",
      "  return id.trim();",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(root, "src", "reader.ts"),
    [
      'import { helper } from "./helper.ts";',
      "",
      "/** Lee un documento. */",
      "export function readDocument(id: string): string {",
      "  return helper(id);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(root, "nexo-palace.config.json"),
    `${JSON.stringify(
      {
        projectName: "fixture-test",
        docs: ["docs"],
        tasteDirs: [".commandcode/taste"],
        codeDirs: ["src"],
        codeExtensions: [".ts"],
        requirementPrefixes: ["TSK"],
        decisionsFile: ".commandcode/taste/decisions.md",
        dbPath: ".nexo-palace/memory.sqlite3",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return root;
}

/** Indexa el fixture con el proveedor offline (sin red). */
async function indexFixture(): Promise<void> {
  resetConfig();
  initProject({ root: fixtureRoot });
  const db = openDb();
  const provider = new OfflineEmbeddingProvider(384);
  await ingestDocuments(provider, { db });
  await extractCode(provider, { db });
  closeDb();
}

/** Conecta con el servidor MCP y devuelve el cliente. */
async function connect(env: Record<string, string> = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-strip-types", "--no-warnings", SERVER],
    cwd: fixtureRoot,
    stderr: "pipe",
    env: {
      ...process.env,
      NEXO_PALACE_ROOT: fixtureRoot,
      ...env,
    } as Record<string, string>,
  });
  const client = new Client({ name: "palace-smoke-test", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

/** Ejecuta la batería de comprobaciones de búsqueda y estado. */
async function checkPhase1(client: Client): Promise<void> {
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  check("expone memory_query", names.includes("memory_query"), names.join(", "));
  check("expone memory_status", names.includes("memory_status"));

  // --- memory_query: consulta en lenguaje natural -----------------------------
  const semantic = await client.callTool({
    name: "memory_query",
    arguments: { query: "combinar búsqueda semántica con coincidencia literal", limit: 5 },
  });
  const semanticText = (semantic.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  check("memory_query responde", semanticText.length > 0);
  const semanticPayload = JSON.parse(semanticText) as {
    count: number;
    results: Array<{ path: string; requirementIds: string[] }>;
  };
  check("memory_query devuelve resultados", semanticPayload.count > 0, `${semanticPayload.count} resultados`);
  check(
    "memory_query alcanza el documento de especificación",
    semanticPayload.results.some((r) => r.path === "docs/spec.md"),
    semanticPayload.results.map((r) => r.path).join(", "),
  );
  check(
    "memory_query reconoce el requisito TSK-01",
    semanticPayload.results.some((r) => r.requirementIds.includes("TSK-01")),
    semanticPayload.results.map((r) => r.requirementIds.join(",")).join(", "),
  );

  // --- memory_query: identificador exacto ------------------------------------
  const exact = await client.callTool({
    name: "memory_query",
    arguments: { query: "TSK-02", scope: "doc", limit: 3 },
  });
  const exactText = (exact.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  const exactPayload = JSON.parse(exactText) as { count: number };
  check("memory_query encuentra el requisito TSK-02", exactPayload.count > 0, `${exactPayload.count} resultados`);

  // --- memory_query: las convenciones son recuperables ------------------------
  // Se busca sin scope restricción porque el fixture no declara tasteDirs
  const taste = await client.callTool({
    name: "memory_query",
    arguments: { query: "normalizan en minúsculas", limit: 3 },
  });
  const tasteText = (taste.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  const tastePayload = JSON.parse(tasteText) as { count: number };
  check("memory_query alcanza las convenciones del proyecto", tastePayload.count > 0, `${tastePayload.count} resultados`);

  // --- memory_status ---------------------------------------------------------
  const status = await client.callTool({ name: "memory_status", arguments: {} });
  const statusText = (status.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  const statusPayload = JSON.parse(statusText) as {
    chunks: number;
    nodes: number;
    projectName?: string;
    projectRoot?: string;
  };
  check("memory_status informa del índice", statusPayload.chunks > 0, `${statusPayload.nodes} nodos`);
  check(
    "memory_status incluye projectName y projectRoot",
    statusPayload.projectName === "fixture-test" && Boolean(statusPayload.projectRoot),
    `${statusPayload.projectName} @ ${statusPayload.projectRoot}`,
  );
}

async function main(): Promise<void> {
  fixtureRoot = createFixture();
  process.stdout.write(`Fixture del proyecto: ${fixtureRoot}\n\n`);

  try {
    await indexFixture();

    // --- Superficie por defecto: completa ------------------------------------
    const client = await connect();
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    check(
      "la superficie por defecto incluye las seis herramientas",
      [
        "memory_query",
        "memory_status",
        "memory_trace",
        "memory_record_decision",
        "memory_map",
        "memory_drift",
      ].every((n) => names.includes(n)),
      names.join(", "),
    );
    await checkPhase1(client);

    // --- memory_trace --------------------------------------------------------
    const trace = await client.callTool({
      name: "memory_trace",
      arguments: { entity: "src/reader.ts", depth: 2 },
    });
    const traceText = (trace.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    const tracePayload = JSON.parse(traceText) as {
      resolved: { path: string } | null;
      dependencies: Array<{ path: string }>;
      requirements: unknown[];
      taste: unknown[];
    };
    check(
      "memory_trace resuelve src/reader.ts",
      tracePayload.resolved?.path === "src/reader.ts",
      tracePayload.resolved?.path ?? "sin resolver",
    );
    check(
      "memory_trace sigue el import a src/helper.ts",
      tracePayload.dependencies.some((d) => d.path === "src/helper.ts"),
      tracePayload.dependencies.map((d) => d.path).join(", "),
    );
    check("memory_trace devuelve el subgrafo", Array.isArray(tracePayload.requirements));

    // --- memory_record_decision ----------------------------------------------
    const decision = await client.callTool({
      name: "memory_record_decision",
      arguments: {
        context: "Prueba de humo de memory_record_decision.",
        decision: "La decisión se persiste, se enlaza en el grafo y se indexa.",
        tags: ["verificacion"],
        relatedFiles: ["src/helper.ts"],
      },
    });
    const decisionText = (decision.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    const decisionPayload = JSON.parse(decisionText) as { id: string; tasteFile: string };
    check(
      "memory_record_decision devuelve un episodio",
      decisionPayload.id.startsWith("decision:"),
      decisionPayload.id,
    );
    check(
      "memory_record_decision escribe en el fichero de decisiones del proyecto",
      decisionPayload.tasteFile === ".commandcode/taste/decisions.md",
      decisionPayload.tasteFile,
    );

    // --- memory_map ----------------------------------------------------------
    const mapped = await client.callTool({
      name: "memory_map",
      arguments: {},
    });
    const mappedText = (mapped.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    const mappedPayload = JSON.parse(mappedText) as {
      skipped: boolean;
      projectName: string;
      stats: { nodes: number };
    };
    check(
      "memory_map sincroniza el índice manteniendo el proyecto",
      mappedPayload.skipped === false &&
        mappedPayload.projectName === "fixture-test" &&
        mappedPayload.stats.nodes > 0,
      `${mappedPayload.stats.nodes} nodos`,
    );

    // --- memory_drift --------------------------------------------------------
    const drift = await client.callTool({
      name: "memory_drift",
      arguments: { dryRun: true },
    });
    const driftText = (drift.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    const driftPayload = JSON.parse(driftText) as {
      changedFiles: unknown[];
      events: unknown[];
    };
    check(
      "memory_drift responde con estructura válida",
      Array.isArray(driftPayload.changedFiles) && Array.isArray(driftPayload.events),
    );

    await client.close();

    // --- Superficie restringida: solo Fase 1 ---------------------------------
    const phase1 = await connect({ PALACE_TOOLS: "phase1" });
    const phase1Names = (await phase1.listTools()).tools.map((t) => t.name).sort();
    check(
      "PALACE_TOOLS=phase1 restringe la superficie",
      !phase1Names.includes("memory_trace") &&
        !phase1Names.includes("memory_record_decision") &&
        !phase1Names.includes("memory_map") &&
        !phase1Names.includes("memory_drift"),
      phase1Names.join(", "),
    );
    await phase1.close();

    // --- CLI `serve` sin NEXO_PALACE_ROOT (resolución dinámica por cwd) -------
    const envWithoutRoot = { ...process.env } as Record<string, string>;
    delete envWithoutRoot.NEXO_PALACE_ROOT;
    delete envWithoutRoot.NEXO_PALACE_CONFIG;
    const cliTransport = new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", "--no-warnings", CLI, "serve"],
      cwd: fixtureRoot,
      stderr: "pipe",
      env: envWithoutRoot,
    });
    const cliClient = new Client({ name: "palace-cli-serve-test", version: "0.1.0" });
    await cliClient.connect(cliTransport);
    const cliStatus = await cliClient.callTool({ name: "memory_status", arguments: {} });
    const cliStatusText = (cliStatus.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    const cliStatusPayload = JSON.parse(cliStatusText) as { projectName: string };
    check(
      "cli.ts serve permanece vivo y resuelve el workspace dinámico por cwd",
      cliStatusPayload.projectName === "fixture-test",
      cliStatusPayload.projectName,
    );
    await cliClient.close();

    // --- CLI `serve` lanzado desde subdirectorio del plugin (.agents/plugins/nexo-palace) ---
    const pluginSubdir = join(fixtureRoot, ".agents", "plugins", "nexo-palace");
    mkdirSync(pluginSubdir, { recursive: true });
    const pluginTransport = new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", "--no-warnings", CLI, "serve"],
      cwd: pluginSubdir,
      stderr: "pipe",
      env: envWithoutRoot,
    });
    const pluginClient = new Client({ name: "palace-plugin-cwd-test", version: "0.1.0" });
    await pluginClient.connect(pluginTransport);
    const pluginStatus = await pluginClient.callTool({ name: "memory_status", arguments: {} });
    const pluginStatusText = (pluginStatus.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    const pluginStatusPayload = JSON.parse(pluginStatusText) as { projectName: string };
    check(
      "cli.ts serve desde cwd de plugin (.agents/plugins/nexo-palace) resuelve la raíz padre",
      pluginStatusPayload.projectName === "fixture-test",
      pluginStatusPayload.projectName,
    );
    await pluginClient.close();
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  process.stdout.write(
    failures === 0 ? "\nTodas las comprobaciones pasaron.\n" : `\n${failures} comprobación(es) fallaron.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
});
