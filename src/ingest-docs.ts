/**
 * Nexo-Palace Engine — ingestor documental (Fase 1).
 *
 * Recorre `docs/` y `.commandcode/taste/`, trocea cada Markdown por jerarquía
 * de encabezados, extrae los metadatos y los IDs de trazabilidad, y puebla:
 *   * `nodes`      — un nodo por documento + un nodo por requisito (EPC-xx).
 *   * `chunks`     — fragmentos con su `header_path`.
 *   * `chunks_fts` — índice léxico BM25.
 *   * `chunks_vec` — índice vectorial.
 *   * `edges`      — `contains` entre documento y requisito.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig, MIN_EMBED_CHARS, projectRoot } from "./config.ts";
import {
  type Db,
  deleteNode,
  ensureVecTable,
  insertVector,
  openDb,
  replaceChunks,
  setMeta,
  upsertEdge,
  upsertNode,
} from "./db.ts";
import { type EmbeddingProvider, describeProvider } from "./embedder.ts";
import { inferStatus, parseMarkdown, parseStatusTables } from "./markdown.ts";
import { isMarkdown, repoRelative, walkFiles } from "./util.ts";

/** Resultado de una pasada de indexación. */
export interface IngestResult {
  files: number;
  documents: number;
  requirements: number;
  chunks: number;
  vectors: number;
  /** Fragmentos demasiado cortos para embeber (se quedan solo en FTS5). */
  skippedShort: number;
  provider: string;
  dim: number;
  /** Archivos que no se pudieron leer. */
  errors: string[];
}

/** Opciones del indexador. */
export interface IngestOptions {
  /** Fuerza un proveedor concreto. */
  provider?: string;
  /** Autoriza a reconstruir la capa vectorial si cambia el proveedor. */
  allowProviderSwitch?: boolean;
  /** Modelo de embeddings. */
  model?: string;
  /** Devuelve `true` para simular la indexación sin escribir. */
  dryRun?: boolean;
  /** Elementos ya indexados (permite probar sin tocar la base). */
  db?: Db;
}

/** Nodo de requisito: un ID de trazabilidad como `EPC-01`. */
function requirementNodeId(reqId: string): string {
  return `req:${reqId}`;
}

/**
 * Indexa todo el corpus documental y lo escribe en la base.
 */
export async function ingestDocuments(
  provider: EmbeddingProvider,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const db = options.db ?? openDb();
  const errors: string[] = [];

  // --- Recolectar archivos -------------------------------------------------
  const files: string[] = [];
  const root = projectRoot();
  const config = getConfig();
  // Los directorios de taste se indexan además de los documentales: contienen
  // convenciones y decisiones, que son conocimiento del proyecto.
  for (const dir of [...config.docs, ...config.tasteDirs]) {
    const abs = join(root, dir);
    walkFiles(abs, isMarkdown, files);
  }
  files.sort();

  // --- Parsear -------------------------------------------------------------
  interface ParsedFile {
    absPath: string;
    relPath: string;
    nodeType: string;
    raw: string;
    parsed: ReturnType<typeof parseMarkdown>;
  }

  const parsedFiles: ParsedFile[] = [];
  for (const absPath of files) {
    const relPath = repoRelative(absPath);
    try {
      const raw = readFileSync(absPath, "utf8");
      const parsed = parseMarkdown(raw);
      parsedFiles.push({
        absPath,
        relPath,
        nodeType: config.tasteDirs.some((dir) => relPath.startsWith(`${dir}/`))
          ? "taste"
          : "doc",
        raw,
        parsed,
      });
    } catch (err) {
      errors.push(`${relPath}: ${(err as Error).message}`);
    }
  }

  // --- Resolución global del estado de cada requisito ----------------------
  // Un mismo requisito aparece en varios documentos, y no todos declaran su
  // estado. La evidencia más fuerte es la tabla de estado del documento que
  // lo define; si no existe, se recurre al estado del documento.
  interface ReqInfo {
    status: string;
    statusSource: "table" | "document" | "inherited";
    docPath: string;
    title: string;
    headerPath: string | null;
  }

  const reqInfo = new Map<string, ReqInfo>();

  for (const file of parsedFiles) {
    const docStatus = inferStatus(file.parsed.meta, file.raw);
    const tableStatus = parseStatusTables(file.raw);

    for (const [reqId, status] of tableStatus) {
      const existing = reqInfo.get(reqId);
      // La tabla gana siempre: es la declaración explícita del estado.
      if (!existing || existing.statusSource !== "table") {
        reqInfo.set(reqId, {
          status,
          statusSource: "table",
          docPath: file.relPath,
          title: file.parsed.title || reqId,
          headerPath: null,
        });
      }
    }

    for (const section of file.parsed.sections) {
      for (const reqId of section.requirementIds) {
        const existing = reqInfo.get(reqId);
        if (existing && existing.statusSource === "table") continue;
        reqInfo.set(reqId, {
          status: docStatus,
          statusSource: "document",
          docPath: file.relPath,
          title: file.parsed.title || reqId,
          headerPath: section.headerPath,
        });
      }
    }
  }

  // Las historias de usuario cuelgan de su épica en la jerarquía de títulos y
  // no declaran estado propio: heredan el de la épica que las contiene.
  for (const file of parsedFiles) {
    for (const section of file.parsed.sections) {
      for (const ancestorId of section.ancestorReqIds) {
        const ancestor = reqInfo.get(ancestorId);
        if (!ancestor || ancestor.statusSource !== "table") continue;
        for (const reqId of section.requirementIds) {
          if (reqId === ancestorId) continue;
          const own = reqInfo.get(reqId);
          if (own && own.statusSource === "table") continue;
          reqInfo.set(reqId, {
            status: ancestor.status,
            statusSource: "inherited",
            docPath: own?.docPath ?? file.relPath,
            title: own?.title ?? reqId,
            headerPath: own?.headerPath ?? null,
          });
        }
      }
    }
  }

  // --- Preparar el corpus para el IDF del proveedor offline ----------------
  const allChunkTexts = parsedFiles.flatMap((f) => f.parsed.sections.map((s) => s.content));
  provider.prepareCorpus?.(allChunkTexts);

  // --- Escribir ------------------------------------------------------------
  if (options.dryRun) {
    return {
      files: files.length,
      documents: parsedFiles.length,
      requirements: 0,
      chunks: allChunkTexts.length,
      vectors: 0,
      skippedShort: 0,
      provider: provider.name,
      dim: provider.dim,
      errors,
    };
  }

  ensureVecTable(db, provider.dim, provider.name, {
    allowSwitch: options.allowProviderSwitch,
  });

  const requirementIds = new Set<string>();
  let chunkCount = 0;
  let vectorCount = 0;
  let skippedShort = 0;

  for (const file of parsedFiles) {
    const docNodeId = `doc:${file.relPath}`;
    const meta = file.parsed.meta;
    const status = inferStatus(meta, file.raw);

    upsertNode(db, {
      id: docNodeId,
      type: file.nodeType,
      path: file.relPath,
      name: file.relPath.split("/").pop() ?? file.relPath,
      status,
      title: file.parsed.title || meta.id || file.relPath,
      meta: {
        docId: meta.id ?? null,
        date: meta.date ?? null,
        priority: meta.priority ?? null,
        author: meta.author ?? null,
        version: meta.version ?? null,
        extra: Object.keys(meta.extra).length > 0 ? meta.extra : undefined,
        contentHash: hashOf(file.raw),
      },
      updatedAt: new Date().toISOString(),
    });

    // Fragmentos del documento.
    const chunks = file.parsed.sections.map((section, seq) => ({
      id: `chunk:${file.relPath}:${seq}`,
      nodeId: docNodeId,
      seq,
      content: section.content,
      headerPath: section.headerPath,
      requirementIds: section.requirementIds,
      contentHash: hashOf(section.content),
    }));
    replaceChunks(db, docNodeId, chunks);
    chunkCount += chunks.length;

    // Nodos de requisito + arista `contains`.
    const fileReqIds = new Set(file.parsed.sections.flatMap((s) => s.requirementIds));
    for (const reqId of fileReqIds) {
      requirementIds.add(reqId);
      const reqNodeId = requirementNodeId(reqId);
      const firstSection = file.parsed.sections.find((s) => s.requirementIds.includes(reqId));
      const info = reqInfo.get(reqId);

      upsertNode(db, {
        id: reqNodeId,
        type: "requirement",
        // El documento canónico es el que declara el estado del requisito.
        path: info?.docPath ?? file.relPath,
        name: reqId,
        status: info?.status ?? status,
        title: info?.title || firstSection?.title || reqId,
        meta: {
          docTitle: file.parsed.title || null,
          docPath: info?.docPath ?? file.relPath,
          headerPath: info?.headerPath ?? firstSection?.headerPath ?? null,
          statusSource: info?.statusSource ?? "document",
          mentionedIn: file.relPath,
        },
        updatedAt: new Date().toISOString(),
      });

      upsertEdge(db, {
        sourceId: docNodeId,
        targetId: reqNodeId,
        relation: "contains",
        confidence: 1,
        meta: { headerPath: firstSection?.headerPath ?? null },
      });
    }

    // Vectores del documento: solo se embeben los fragmentos cuyo contenido
    // ha cambiado o que aún no tienen vector.
    const pending = chunks.filter(
      (c) => c.content.length >= MIN_EMBED_CHARS && needsEmbedding(db, c),
    );
    skippedShort += chunks.filter((c) => c.content.length < MIN_EMBED_CHARS).length;
    if (pending.length > 0) {
      const vectors = await provider.embed(pending.map((c) => c.content));
      for (let i = 0; i < vectors.length; i++) {
        insertVector(db, pending[i].id, vectors[i]);
        vectorCount++;
      }
    }
  }

  // Limpiar documentos que ya no existen en disco.
  const knownDocIds = new Set(parsedFiles.map((f) => `doc:${f.relPath}`));
  const staleDocs = db
    .prepare("SELECT id FROM nodes WHERE type IN ('doc','taste')")
    .all() as Array<{ id: string }>;
  for (const row of staleDocs) {
    if (!knownDocIds.has(row.id)) deleteNode(db, row.id);
  }

  // Requisitos huérfanos: ya no referenciados por ningún documento.
  const staleReqs = db
    .prepare("SELECT id FROM nodes WHERE type = 'requirement'")
    .all() as Array<{ id: string }>;
  for (const row of staleReqs) {
    if (!requirementIds.has(row.id.replace(/^req:/, ""))) deleteNode(db, row.id);
  }

  setMeta(db, "indexed_at", new Date().toISOString());
  setMeta(db, "doc_provider", provider.name);

  return {
    files: files.length,
    documents: parsedFiles.length,
    requirements: requirementIds.size,
    chunks: chunkCount,
    vectors: vectorCount,
    skippedShort,
    provider: describeProvider(provider),
    dim: provider.dim,
    errors,
  };
}

/**
 * Indica si un fragmento necesita embedding.
 * No lo necesita si ya tiene vector y su contenido no ha cambiado.
 */
function needsEmbedding(db: Db, chunk: { id: string; contentHash?: string }): boolean {
  const row = db
    .prepare("SELECT content_hash FROM chunks WHERE id = ?")
    .get(chunk.id) as { content_hash: string | null } | undefined;
  if (!row) return true;
  if (row.content_hash !== chunk.contentHash) return true;
  try {
    const hasVector = db.prepare("SELECT 1 AS x FROM chunks_vec WHERE chunk_id = ?").get(chunk.id);
    return !hasVector;
  } catch {
    return true;
  }
}

/** Hash determinista de contenido. */
function hashOf(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
