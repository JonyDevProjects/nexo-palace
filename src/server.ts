/**
 * Nexo-Palace Engine — servidor MCP sobre stdio.
 *
 * Expone el índice híbrido del proyecto como herramientas estándar para
 * cualquier agente. Toda la salida de diagnóstico va a `stderr`: `stdout` es
 * el canal del protocolo MCP y no puede contaminarse con logs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getConfig, initProject, loadEnv, OFFLINE_EMBEDDING_DIM } from "./config.ts";
import {
  createEmbeddingProvider,
  OfflineEmbeddingProvider,
  providerFromId,
  type EmbeddingProvider,
} from "./embedder.ts";
import { indexProvider, indexStats, openDb } from "./db.ts";
import { search } from "./query.ts";
import { traceEntity } from "./trace.ts";
import { recordDecision } from "./episodes.ts";

/** Herramientas de la Fase 1 (búsqueda híbrida y estado del índice). */
const PHASE1_TOOLS = ["memory_query", "memory_status"] as const;

/** Herramientas de las Fases 2 y 3 (grafo de trazabilidad y memoria decisional). */
const PHASE23_TOOLS = ["memory_trace", "memory_record_decision"] as const;

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
function resolveQueryProvider(db: ReturnType<typeof openDb>): EmbeddingProvider {
  const index = indexProvider(db);
  const fromIndex = providerFromId(index.id, index.dim);
  if (fromIndex) return fromIndex;
  process.stderr.write(
    "[nexo-palace] Proveedor vectorial del índice no disponible: la búsqueda será léxica.\n",
  );
  return new OfflineEmbeddingProvider(index.dim ?? OFFLINE_EMBEDDING_DIM);
}

/** Construye y arranca el servidor MCP. */
export async function startServer(): Promise<McpServer> {
  // El proyecto se resuelve antes de cargar el `.env`: el `.env` que cuenta es
  // el del proyecto indexado, no el del directorio desde el que se lanzó el
  // servidor.
  initProject();
  loadEnv();

  const config = getConfig();
  const project = config.projectName;

  const db = openDb();
  const provider = resolveQueryProvider(db);
  const enabled = enabledTools();
  const isEnabled = (name: string): boolean => enabled.has(name);

  const server = new McpServer(
    { name: "nexo-palace", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        `Memoria del proyecto ${project}. Usa memory_query para recuperar requisitos, ` +
        "decisiones y documentación antes de proponer o modificar código.",
    },
  );

  // --- memory_query --------------------------------------------------------
  if (isEnabled("memory_query")) {
    server.registerTool(
      "memory_query",
      {
        title: "Consultar la memoria del proyecto",
        description:
          "Búsqueda híbrida (semántica + léxica) sobre la documentación, el código y " +
          `las convenciones del proyecto ${project}. Devuelve fragmentos con su ruta, ` +
          "cabecera y requisitos asociados. Úsala antes de proponer o modificar código.",
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
        const results = await search(query, provider, {
          scope: scope ?? "all",
          limit: limit ?? 8,
          pathPrefix,
        });

        const payload = {
          query,
          count: results.length,
          provider: provider.name,
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
        const trace = traceEntity(entity, depth ?? 2, db);
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
        // Se usa el proveedor del índice: si se creara otro, el embedding de la
        // decisión no sería comparable con los vectores ya almacenados.
        const episode = await recordDecision(
          { context, decision, tags, relatedFiles },
          db,
          provider,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(episode, null, 2) }],
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
        description: "Informa del estado del índice: documentos, fragmentos, vectores y proveedor de embeddings.",
        inputSchema: {},
      },
      async () => {
        const stats = indexStats(db);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
        };
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[nexo-palace] servidor MCP listo — proyecto: ${project}, proveedor de embeddings: ${provider.name} (dim ${provider.dim})\n` +
      `[nexo-palace] herramientas activas: ${Array.from(enabled).join(", ")}\n`,
  );
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
