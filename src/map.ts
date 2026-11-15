/**
 * Nexo-Palace Engine — orquestación de cartografía (`map` / `index`).
 *
 * Unifica el flujo de indexado documental y extracción AST de código para que
 * tanto el CLI (`nxpl map`) como la herramienta MCP (`memory_map`) y los Git
 * hooks compartan exactamente la misma lógica sin duplicación.
 */
import { getConfig } from "./config.ts";
import { type Db, indexProvider, indexStats, openDb, setMeta } from "./db.ts";
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
  providerFromId,
} from "./embedder.ts";
import { type CodeExtractResult, extractCode } from "./extract-code.ts";
import { type IngestResult, ingestDocuments } from "./ingest-docs.ts";

/** Opciones de ejecución de la cartografía. */
export interface MapOptions {
  db?: Db;
  provider?: string;
  model?: string;
  /** Permite cambiar de proveedor descartando los vectores anteriores. */
  allowProviderSwitch?: boolean;
  /**
   * Modo seguro para hooks/automatización: si el proveedor con el que se
   * construyó el índice no está disponible (falta API key o daemon apagado),
   * omite el reindexado sin destruir los vectores existentes ni fallar.
   */
  bestEffort?: boolean;
  onDocProgress?: (current: number, total: number, message: string) => void;
  onCodeProgress?: (current: number, total: number, message: string) => void;
}

/** Resultado consolidado de la cartografía. */
export interface MapResult {
  skipped: boolean;
  reason?: string;
  projectName: string;
  root: string;
  provider: EmbeddingProvider | null;
  docs?: IngestResult;
  code?: CodeExtractResult;
  stats: ReturnType<typeof indexStats>;
}

/**
 * Resuelve el proveedor de embeddings respetando el índice existente salvo
 * cambio explícito, evitando destrucciones accidentales de la tabla vectorial.
 */
async function resolveMapProvider(
  db: Db,
  options: MapOptions,
): Promise<{ provider: EmbeddingProvider | null; reason?: string }> {
  const index = indexProvider(db);
  const explicit = options.provider || process.env.PALACE_EMBED_PROVIDER || undefined;

  if (explicit) {
    try {
      const p = await createEmbeddingProvider({
        provider: explicit,
        model: options.model,
      });
      return { provider: p };
    } catch (err) {
      if (options.bestEffort) {
        return { provider: null, reason: (err as Error).message };
      }
      throw err;
    }
  }

  if (index.id) {
    const existing = providerFromId(index.id, index.dim);
    if (existing) {
      return { provider: existing };
    }
    if (options.bestEffort) {
      return {
        provider: null,
        reason:
          `El proveedor original del índice (${index.id}) no está disponible en este entorno; ` +
          "se omite la reindexación para preservar los vectores existentes.",
      };
    }
  }

  try {
    const auto = await createEmbeddingProvider({ model: options.model });
    return { provider: auto };
  } catch (err) {
    if (options.bestEffort) {
      return { provider: null, reason: (err as Error).message };
    }
    throw err;
  }
}

/**
 * Cartografía documentación y código del proyecto actual en la base de datos.
 */
export async function runMap(options: MapOptions = {}): Promise<MapResult> {
  const db = options.db ?? openDb();
  const config = getConfig();

  const resolved = await resolveMapProvider(db, options);
  if (!resolved.provider) {
    return {
      skipped: true,
      reason: resolved.reason ?? "Proveedor de embeddings no disponible.",
      projectName: config.projectName,
      root: config.root,
      provider: null,
      stats: indexStats(db),
    };
  }

  const provider = resolved.provider;
  const allowSwitch = options.allowProviderSwitch ?? Boolean(options.provider || process.env.PALACE_EMBED_PROVIDER);

  try {
    const docs = await ingestDocuments(provider, {
      db,
      allowProviderSwitch: allowSwitch,
      onProgress: options.onDocProgress,
    });

    const code = await extractCode(provider, {
      db,
      allowProviderSwitch: allowSwitch,
      onProgress: options.onCodeProgress,
    });

    setMeta(db, "indexed_at", new Date().toISOString());

    return {
      skipped: false,
      projectName: config.projectName,
      root: config.root,
      provider,
      docs,
      code,
      stats: indexStats(db),
    };
  } catch (err) {
    if (options.bestEffort) {
      return {
        skipped: true,
        reason: (err as Error).message,
        projectName: config.projectName,
        root: config.root,
        provider: null,
        stats: indexStats(db),
      };
    }
    throw err;
  }
}
