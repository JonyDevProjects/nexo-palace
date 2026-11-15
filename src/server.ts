/**
 * Nexo-Palace Engine — servidor MCP sobre stdio.
 *
 * Expone el índice híbrido del proyecto como herramientas estándar para
 * cualquier agente. Toda la salida de diagnóstico va a `stderr`: `stdout` es
 * el canal del protocolo MCP y no puede contaminarse con logs.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  CONFIG_FILENAME,
  findConfigFile,
  getConfig,
  initProject,
  loadEnv,
  OFFLINE_EMBEDDING_DIM,
  type PalaceConfig,
  resetConfig,
} from "./config.ts";
import { type Db, indexProvider, indexStats, openDb } from "./db.ts";
import { detectDrift } from "./drift.ts";
import {
  OfflineEmbeddingProvider,
  providerFromId,
  type EmbeddingProvider,
} from "./embedder.ts";
import { recordDecision } from "./episodes.ts";
import { runMap } from "./map.ts";
import { search } from "./query.ts";
import { traceEntity } from "./trace.ts";

/** Herramientas de la Fase 1 (búsqueda híbrida y estado del índice). */
const PHASE1_TOOLS = ["memory_query", "memory_status"] as const;

/** Herramientas de las Fases 2 y 3 (grafo de trazabilidad, decisiones, mapeo y deriva). */
const PHASE23_TOOLS = [
  "memory_trace",
  "memory_record_decision",
  "memory_map",
  "memory_drift",
] as const;

/**
 * Lee la configuración de herramientas desde el entorno.
 *
 * Por defecto se expone la superficie completa. Para restringirla a la Fase 1
 * mientras se valida:
 *
 *   PALACE_TOOLS=phase1 npm run palace:mcp
 */
function enabledTools(): Set<string> {
  const raw = (process.env.PALACE_TOOLS || "").toLowerCase().trim();
  if (raw === "phase1") return new Set(PHASE1_TOOLS);
  if (raw === "all" || raw === "") {
    return new Set([...PHASE1_TOOLS, ...PHASE23_TOOLS]);
  }
  const custom = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return new Set(custom.length > 0 ? custom : [...PHASE1_TOOLS, ...PHASE23_TOOLS]);
}

/**
 * Proveedor para las consultas: el mismo con el que se indexó el corpus.
 * Si no está disponible, la búsqueda vectorial se desactiva y solo queda la
 * léxica, en lugar de mezclar espacios vectoriales distintos.
 */
function resolveQueryProvider(db: Db): EmbeddingProvider {
  const index = indexProvider(db);
  const fromIndex = providerFromId(index.id, index.dim);
  if (fromIndex) return fromIndex;
  process.stderr.write(
    "[nexo-palace] Proveedor vectorial del índice no disponible: la búsqueda será léxica.\n",
  );
  return new OfflineEmbeddingProvider(index.dim ?? OFFLINE_EMBEDDING_DIM);
}

/**
 * Convierte una URI MCP (`file:///...`) a ruta local existente, o `null` si no aplica.
 */
export function resolveRootFromUri(uri: string): string | null {
  if (!uri || !uri.startsWith("file://")) return null;
  try {
    const localPath = resolve(fileURLToPath(uri));
    return existsSync(localPath) ? localPath : null;
  } catch {
    return null;
  }
}

/**
 * Selecciona la mejor raíz de trabajo entre las reportadas por `roots/list`.
 * Prioriza raíces que ya contienen `nexo-palace.config.json` o `.nexo-palace`.
 */
export function pickWorkspaceRoot(roots: Array<{ uri: string }>): string | null {
  const candidates: string[] = [];
  for (const r of roots) {
    const resolved = resolveRootFromUri(r.uri);
    if (resolved) candidates.push(resolved);
  }
  if (candidates.length === 0) return null;

  const configured = candidates.find(
    (dir) => existsSync(join(dir, CONFIG_FILENAME)) || existsSync(join(dir, ".nexo-palace")),
  );
  return configured ?? candidates[0];
}

/** Opciones de arranque del servidor MCP. */
export interface StartServerOptions {
  root?: string;
  config?: string;
  /** Permite inyectar otro transporte en tests o evitar conectar stdio. */
  connectTransport?: boolean;
}

/** Estado vivo del proyecto enlazado al servidor MCP. */
interface ServerContext {
  config: PalaceConfig;
  db: Db;
  provider: EmbeddingProvider;
  hasExplicitRoot: boolean;
}

/** Extrae `--root` y `--config` de `process.argv` cuando se invoca directo. */
function argvRootOptions(): { root?: string; config?: string } {
  const args = process.argv.slice(2);
  let root: string | undefined;
  let config: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) {
      root = args[++i];
    } else if (args[i] === "--config" && args[i + 1]) {
      config = args[++i];
    }
  }
  return { root, config };
}

/** Construye y arranca el servidor MCP. */
export async function startServer(options: StartServerOptions = {}): Promise<McpServer> {
  const cliOpts = argvRootOptions();
  const explicitRoot = options.root ?? cliOpts.root ?? process.env.NEXO_PALACE_ROOT;
  const explicitConfig = options.config ?? cliOpts.config ?? process.env.NEXO_PALACE_CONFIG;

  // El proyecto se resuelve antes de cargar el `.env`: el `.env` que cuenta es
  // el del proyecto indexado, no el del directorio desde el que se lanzó el servidor.
  initProject({ root: explicitRoot, config: explicitConfig });
  loadEnv();

  const initialConfig = getConfig();
  const initialDb = openDb();
  const ctx: ServerContext = {
    config: initialConfig,
    db: initialDb,
    provider: resolveQueryProvider(initialDb),
    hasExplicitRoot: Boolean(explicitRoot || explicitConfig),
  };

  let pendingRootSync: Promise<void> | null = null;

  function rebindProject(nextRoot: string): void {
    const resolvedNext = resolve(nextRoot);
    if (resolvedNext === ctx.config.root) return;

    resetConfig();
    initProject({ root: resolvedNext });
    loadEnv();
    ctx.config = getConfig();
    ctx.db = openDb();
    ctx.provider = resolveQueryProvider(ctx.db);
    process.stderr.write(
      `[nexo-palace] workspace actualizado vía MCP roots: ${ctx.config.projectName} (${ctx.config.root})\n`,
    );
  }

  async function ensureSynced(): Promise<void> {
    if (pendingRootSync) await pendingRootSync;
  }

  const enabled = enabledTools();
  const isEnabled = (name: string): boolean => enabled.has(name);

  const server = new McpServer(
    { name: "nexo-palace", version: "0.1.3" },
    {
      capabilities: { tools: {} },
      instructions:
        `Memoria activa del proyecto ${ctx.config.projectName}. PROTOCOLO DE USO:\n` +
        "1. ANTES de explorar a ciegas con find/grep o abrir varios archivos, usa `memory_query` para localizar requisitos (`EPC`, `US`, `RF`), arquitectura y convenciones (`taste`), y `memory_trace` sobre archivos clave.\n" +
        "2. Al tomar decisiones técnicas, de diseño o resolver bugs complejos, usa `memory_record_decision`.\n" +
        "3. Tras modificar código o documentación, usa `memory_map` para sincronizar el índice y `memory_drift` para revisar impacto en requisitos.",
    },
  );

  // Sincronización dinámica con MCP Roots cuando el cliente soporta `roots/list`.
  const syncRootsFromClient = (): void => {
    if (ctx.hasExplicitRoot) return;
    const caps = server.server.getClientCapabilities();
    if (!caps?.roots) return;

    pendingRootSync = (async () => {
      try {
        const res = await server.server.listRoots();
        const nextRoot = pickWorkspaceRoot(res.roots ?? []);
        if (nextRoot) rebindProject(nextRoot);
      } catch (err) {
        process.stderr.write(`[nexo-palace] aviso al consultar MCP roots: ${(err as Error).message}\n`);
      } finally {
        pendingRootSync = null;
      }
    })();
  };

  server.server.oninitialized = () => {
    syncRootsFromClient();
    const caps = server.server.getClientCapabilities();
    if (!ctx.hasExplicitRoot && caps?.roots?.listChanged) {
      server.server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
        syncRootsFromClient();
      });
    }
  };

  // --- memory_query --------------------------------------------------------
  if (isEnabled("memory_query")) {
    server.registerTool(
      "memory_query",
      {
        title: "Consultar la memoria del proyecto",
        description:
          "Búsqueda híbrida (semántica + léxica) sobre la documentación, el código y " +
          "las convenciones del proyecto. Devuelve fragmentos con su ruta, " +
          "cabecera y requisitos asociados. Úsala ANTES de explorar archivos manualmente o modificar código.",
        inputSchema: {
          query: z.string().describe("Consulta en lenguaje natural o identificadores exactos (p. ej. 'EPC-02', 'MenuEditor')."),
          scope: z
            .string()
            .optional()
            .describe(
              "Alcance: 'all' (por defecto), 'doc', 'code', 'test', 'taste', 'requirement' o una combinación separada por comas.",
            ),
          limit: z.number().int().min(1).max(30).optional().describe("Máximo de resultados (por defecto 8)."),
          pathPrefix: z.string().optional().describe("Acota a rutas que empiezan por este prefijo (p. ej. 'docs/')."),
        },
      },
      async ({ query, scope, limit, pathPrefix }) => {
        await ensureSynced();
        const results = await search(
          query,
          ctx.provider,
          {
            scope: scope ?? "all",
            limit: limit ?? 8,
            pathPrefix,
          },
          ctx.db,
        );

        const payload = {
          project: ctx.config.projectName,
          root: ctx.config.root,
          query,
          count: results.length,
          provider: ctx.provider.name,
          results: results.map((r) => ({
            path: r.path,
            nodeType: r.nodeType,
            title: r.title,
            headerPath: r.headerPath,
            status: r.status,
            score: r.score,
            literalMatch: r.literal,
            requirementIds: r.requirementIds,
            content: r.content,
          })),
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      },
    );
  }

  // --- memory_trace --------------------------------------------------------
  if (isEnabled("memory_trace")) {
    server.registerTool(
      "memory_trace",
      {
        title: "Trazar el origen de un archivo o símbolo",
        description:
          "Dado un archivo o símbolo (p. ej. 'components/menu/MenuPublicView.tsx'), devuelve " +
          "el subgrafo de trazabilidad: qué requisitos lo originaron, qué tests lo validan, " +
          "qué convenciones de taste le aplican y de qué documentos salió.",
        inputSchema: {
          entity: z.string().describe("Ruta relativa, nombre de archivo o símbolo (función, clase, componente)."),
          depth: z.number().int().min(1).max(3).optional().describe("Profundidad del recorrido (por defecto 2)."),
        },
      },
      async ({ entity, depth }) => {
        await ensureSynced();
        const trace = traceEntity(entity, depth ?? 2, ctx.db);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(trace, null, 2) }],
        };
      },
    );
  }

  // --- memory_record_decision ----------------------------------------------
  if (isEnabled("memory_record_decision")) {
    server.registerTool(
      "memory_record_decision",
      {
        title: "Registrar una decisión de arquitectura",
        description:
          "Persiste una decisión tomada durante el trabajo (contexto, decisión y etiquetas) " +
          "en la memoria del proyecto, para que los agentes futuros la recuperen. " +
          "Úsala al cerrar una tarea tras resolver un bug complejo o fijar una convención.",
        inputSchema: {
          context: z.string().describe("Situación que originó la decisión (qué problema se enfrentaba)."),
          decision: z.string().describe("Decisión tomada y su motivo."),
          tags: z.array(z.string()).optional().describe("Etiquetas para la recuperación posterior (p. ej. 'iconos', 'alérgenos')."),
          relatedFiles: z.array(z.string()).optional().describe("Archivos o requisitos relacionados."),
        },
      },
      async ({ context, decision, tags, relatedFiles }) => {
        await ensureSynced();
        // Se usa el proveedor del índice: si se creara otro, el embedding de la
        // decisión no sería comparable con los vectores ya almacenados.
        const episode = await recordDecision(
          { context, decision, tags, relatedFiles },
          ctx.db,
          ctx.provider,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(episode, null, 2) }],
        };
      },
    );
  }

  // --- memory_map ----------------------------------------------------------
  if (isEnabled("memory_map")) {
    server.registerTool(
      "memory_map",
      {
        title: "Mapear / sincronizar cambios en la memoria del proyecto",
        description:
          "Reindexa documentación y código (AST + grafo de trazabilidad) tras editar archivos. " +
          "Conserva el proveedor de embeddings del índice si no se especifica otro.",
        inputSchema: {
          provider: z
            .enum(["auto", "litert", "gemini", "ollama", "offline"])
            .optional()
            .describe("Proveedor opcional. Si se omite, conserva el proveedor actual del índice."),
          allowProviderSwitch: z
            .boolean()
            .optional()
            .describe("Solo true si deseas reconstruir los vectores con otro proveedor distinto."),
        },
      },
      async ({ provider, allowProviderSwitch }) => {
        await ensureSynced();
        const result = await runMap({
          db: ctx.db,
          provider,
          allowProviderSwitch,
          bestEffort: !provider,
        });
        if (result.provider) {
          ctx.provider = result.provider;
        }
        const payload = {
          skipped: result.skipped,
          reason: result.reason ?? null,
          projectName: result.projectName,
          root: result.root,
          docs: result.docs ?? null,
          code: result.code ?? null,
          stats: result.stats,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      },
    );
  }

  // --- memory_drift --------------------------------------------------------
  if (isEnabled("memory_drift")) {
    server.registerTool(
      "memory_drift",
      {
        title: "Detectar deriva entre cambios de código y requisitos",
        description:
          "Compara los archivos de código modificados (vía Git) frente a los requisitos enlazados en el grafo " +
          "para verificar qué requisitos o especificaciones necesitan revisión.",
        inputSchema: {
          baseRef: z.string().optional().describe("Referencia Git contra la que comparar (por defecto HEAD)."),
          dryRun: z
            .boolean()
            .optional()
            .describe("Si es true (por defecto), consulta sin marcar nodos como NEEDS_REVIEW."),
        },
      },
      async ({ baseRef, dryRun }) => {
        await ensureSynced();
        const result = detectDrift(
          { baseRef, mark: dryRun === false },
          ctx.db,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }

  // --- memory_status -------------------------------------------------------
  if (isEnabled("memory_status")) {
    server.registerTool(
      "memory_status",
      {
        title: "Estado del índice de memoria",
        description:
          "Informa del proyecto activo, raíz resuelta, documentos, fragmentos, vectores y proveedor de embeddings.",
        inputSchema: {},
      },
      async () => {
        await ensureSynced();
        const stats = indexStats(ctx.db);
        const home = resolve(homedir());
        const configFile = findConfigFile(ctx.config.root);
        let warning: string | null = null;
        if (ctx.config.root === "/" || ctx.config.root === home) {
          warning =
            `El servidor apunta a '${ctx.config.root}', que no parece ser un repositorio de proyecto. ` +
            "Verifica que no haya NEXO_PALACE_ROOT fijo y que el cliente MCP abra el proyecto en su raíz.";
        } else if (stats.nodes === 0) {
          warning =
            "El índice del proyecto está vacío (0 nodos). Ejecuta memory_map o `nxpl map` para cartografiar el repositorio.";
        }

        const payload = {
          projectName: ctx.config.projectName,
          projectRoot: ctx.config.root,
          configFile,
          dbPath: ctx.config.dbPath,
          ...stats,
          ...(warning ? { warning } : {}),
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      },
    );
  }

  if (options.connectTransport !== false) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(
      `[nexo-palace] servidor MCP listo — proyecto: ${ctx.config.projectName} (${ctx.config.root}), proveedor: ${ctx.provider.name} (dim ${ctx.provider.dim})\n` +
        `[nexo-palace] herramientas activas: ${Array.from(enabled).join(", ")}\n`,
    );
  }
  return server;
}

/** Punto de entrada cuando el archivo se ejecuta directamente. */
const isMain = (() => {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("server.ts") || entry.endsWith("server.js");
})();

if (isMain) {
  startServer().catch((err) => {
    process.stderr.write(`[nexo-palace] error fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
