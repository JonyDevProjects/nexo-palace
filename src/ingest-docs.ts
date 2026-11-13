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

  // --- Reconstruir las decisiones registradas --------------------------------
  //
  // `memory_record_decision` crea el nodo de decisión al registrarlo, pero el
  // nodo vive en la base, no en el repositorio. Si la base se reconstruye
  // (índice nuevo, base borrada, otro equipo), las decisiones dejarían de
  // estar en el grafo aunque su texto siga en el fichero de decisiones.
  //
  // El fichero de decisiones es la fuente de verdad: se reconstruyen desde él
  // los nodos que falten, para que el índice sea reproducible a partir del
  // repositorio. Se usa parseAsDecisions (Opción C Refinada) que detecta
  // múltiples formatos y rutas estándar sin acoplarse a CommandCode.
  const decisions = parseAsDecisions(parsedFiles, getConfig().decisionsFile);
  for (const decision of decisions) {
    if (decision.episodeId) {
      const exists = db.prepare("SELECT id FROM nodes WHERE id = ?").get(decision.episodeId);
      if (exists) continue;
    }

    upsertNode(db, {
      id: decision.id,
      type: "decision",
      path: decision.path,
      name: decision.title.slice(0, 80),
      status: "accepted",
      title: decision.title.slice(0, 120),
      meta: { context: decision.context, tags: decision.tags, relatedFiles: decision.relatedFiles },
      updatedAt: new Date().toISOString(),
    });

    // Fragmento indexable: la decisión debe poder recuperarse por búsqueda.
    // El formato es el mismo que escribe `memory_record_decision`, para que
    // una decisión reconstruida y una recién registrada se comporten igual.
    const content = [
      `## Decisión ${decision.date} — ${decision.tags.join(", ") || "general"}`,
      "",
      `**Contexto:** ${decision.context}`,
      "",
      `**Decisión:** ${decision.title}`,
      decision.relatedFiles.length > 0
        ? `\n**Archivos relacionados:** ${decision.relatedFiles.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const chunkId = `chunk:${decision.id}`;
    replaceChunks(db, decision.id, [
      {
        id: chunkId,
        nodeId: decision.id,
        seq: 0,
        content,
        headerPath: "Decisión registrada",
        requirementIds: [],
        contentHash: hashOf(content),
      },
    ]);
    chunkCount++;

    if (content.length >= MIN_EMBED_CHARS && needsEmbedding(db, { id: chunkId, contentHash: hashOf(content) })) {
      const [vector] = await provider.embed([content]);
      if (vector) {
        insertVector(db, chunkId, vector);
        vectorCount++;
      }
    }

    for (const related of decision.relatedFiles) {
      const clean = related.replace(/^\.\//, "");
      const target = db.prepare("SELECT id FROM nodes WHERE path = ?").get(clean) as
        | { id: string }
        | undefined;
      if (!target) continue;
      upsertEdge(db, {
        sourceId: decision.id,
        targetId: target.id,
        relation: "references",
        confidence: 1,
        meta: { via: "decision" },
      });
    }
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
 * Una decisión reconstruida desde el fichero de decisiones del proyecto.
 */
interface ParsedDecision {
  /** Identificador del nodo en el grafo. */
  id: string;
  /** Identificador del episodio, si el bloque lo declara. */
  episodeId: string | null;
  /** Ruta del fichero donde vive la decisión. */
  path: string;
  /** Título de la decisión. */
  title: string;
  /** Contexto que la originó. */
  context: string;
  /** Fecha de la decisión, tal como aparece en el fichero. */
  date: string;
  /** Etiquetas de la decisión. */
  tags: string[];
  /** Archivos relacionados. */
  relatedFiles: string[];
}

/**
 * Reconstruye las decisiones a partir del fichero de decisiones del proyecto.
 *
 * El formato es el que escribe `memory_record_decision`:
 *
 *   ### 2026-11-12 — etiquetas
 *   * **Contexto:** ...
 *   * **Decisión:** ...
 *   * **Archivos relacionados:** a.ts, b.ts
 *   * **Episodio:** `decision:2026-11-12T09-44-18-523Z`
 */
function parseDecisionFile(
  parsedFiles: Array<{ relPath: string; raw: string }>,
): ParsedDecision[] {
  const decisions: ParsedDecision[] = [];
  const decisionsPath = getConfig().decisionsFile;

  for (const file of parsedFiles) {
    if (file.relPath !== decisionsPath) continue;

    // Cada bloque empieza con un encabezado `### fecha — etiquetas`.
    const blocks = file.raw.split(/^###\s+/m).slice(1);
    for (const block of blocks) {
      const lines = block.split("\n");
      const header = lines[0] ?? "";
      const date = header.split("—")[0]?.trim() ?? "";
      const tagPart = header.split("—")[1]?.trim() ?? "";

      const context = /\*\*Contexto:\*\*\s*(.+)/.exec(block)?.[1]?.trim() ?? "";
      const title = /\*\*Decisi[oó]n:\*\*\s*(.+)/.exec(block)?.[1]?.trim() ?? "";
      const related = /\*\*Archivos relacionados:\*\*\s*(.+)/.exec(block)?.[1] ?? "";
      const episodeId = /\*\*Episodio:\*\*\s*`([^`]+)`/.exec(block)?.[1] ?? null;

      if (!title && !context) continue;

      const relatedFiles = related
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);

      const tags = tagPart
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      decisions.push({
        id: episodeId ?? `decision:${date}:${title.slice(0, 40)}`,
        episodeId,
        path: file.relPath,
        title: title || context,
        context,
        date,
        tags,
        relatedFiles,
      });
    }
  }

  return decisions;
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

// ============================================================================
// Parser multi-formato para decisiones (Opción C Refinada)
// ============================================================================

interface RawADR {
  title: string;
  context: string;
  status?: string;
  tags: string[];
  relatedFiles: string[];
  date: string;
}

/**
 * Decide si una ruta corresponde a un archivo de decisiones o ADR por convenio de nombres.
 * Coincide con rutas que son log de decisiones, o directorios adr/adrs/decisions.
 */
function isDecisionPath(relPath: string, decisionsFile: string): boolean {
  // Ruta explícita configurada
  if (relPath === decisionsFile) return true;
  // Convención de directorios: docs/adr/*, docs/adrs/*, docs/decisions/*
  if (/^(docs?|\.commandcode\/taste)\/(adrs?|decisions?)\//i.test(relPath)) return true;
  // Convención de nombre: architecture-decisions.md, adr-log.md, etc.
  if (/\/architecture-decisions\.md$/i.test(relPath)) return true;
  if (/\/[^/]+-decisions?\.md$/i.test(relPath)) return true;
  // Nombre de archivo individual tipo adr-001.md, adr_002.md, etc.
  if (/^(.*[\\/])?(adr[-_]?\d+|ADR[-_]?\d+)\.md$/i.test(relPath)) return true;
  return false;
}

/**
 * Parsea un documento como decisiones individuales usando reglas estructurales.
 * Intenta detectar ADRs en múltiples formatos:
 * - Log continuo CommandCode: ### 2026-11-10 — tags
 * - Secciones MADR/A4DR: ## [ADR-XXX] Título con subsecciones Contexto/Decisión
 * - Formato simplificado: # ADR-XXX: Título + **Decisión**: ...
 */
function parseAsDecisions(
  parsedFiles: Array<{ relPath: string; raw: string }>,
  decisionsFile: string,
): ParsedDecision[] {
  const decisions: ParsedDecision[] = [];

  for (const file of parsedFiles) {
    if (!isDecisionPath(file.relPath, decisionsFile)) continue;

    const adrs = extractADRsFromContent(file.raw, file.relPath);
    for (const adr of adrs) {
      const epochId = adr.date
        ? `decision:${adr.date}:${adr.title.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "-")}`
        : `decision:adr-${file.relPath.split("/").pop() ?? "unknown"}:${adr.title.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "-")}`;

      decisions.push({
        id: epochId,
        episodeId: null,
        path: file.relPath,
        title: adr.title,
        context: adr.context,
        date: adr.date || new Date().toISOString().slice(0, 10),
        tags: adr.tags,
        relatedFiles: adr.relatedFiles,
      });
    }
  }

  return decisions;
}

/**
 * Extrae decisiones individuales del contenido crudo de un fichero.
 * Soporta tres formatos simultáneos.
 */
function extractADRsFromContent(raw: string, relPath: string): RawADR[] {
  const results: RawADR[] = [];

  // --- Formato 1: Log continuo CommandCode (### fecha — tags) ---
  const ccBlocks = raw.split(/^### /m).slice(1);
  const ccFormatDetected = ccBlocks.some((b) => /^\d{4}-\d{2}-\d{2}\s+—/.test(b.split("\n")[0]));

  if (ccFormatDetected) {
    for (const block of ccBlocks) {
      const lines = block.split("\n");
      const header = lines[0] ?? "";
      const date = header.split("—")[0]?.trim() ?? "";
      const tagPart = header.split("—")[1]?.trim() ?? "";

      const contextMatch = /\*\*Contexto:\*\*\s*(.+)/.exec(block)?.[1]?.trim();
      const titleMatch = /\*\*Decisi[oó]n:\*\*\s*(.+)/.exec(block)?.[1]?.trim();
      const relatedMatch = /\*\*Archivos relacionados:\*\*\s*(.+)/.exec(block)?.[1];

      if (!titleMatch && !contextMatch) continue;

      results.push({
        title: titleMatch || "Sin título",
        context: contextMatch || "",
        date: date.trim(),
        tags: tagPart.split(",").map((t) => t.trim()).filter(Boolean),
        relatedFiles: relatedMatch
          ?.split(",")
          .map((f) => f.trim())
          .filter(Boolean) ?? [],
      });
    }
  }

  // --- Formato 2: ADR individual (por sección o por archivo) ---
  // Busca secciones que empiecen con ## [ADR-XXX] o ## ADR XXX: Título
  // Luego busca subsecciones Contexto/Decisión dentro de cada bloque.
  const adrSectionRegex = /^## \[?[Aa][Dd][Rr][-_\s]?(\d+)\]?\s*-?\s*(.+)$/gm;
  const sections: Array<{ header: string; body: string }> = [];
  let match;

  // Si detectamos formato CC, también buscar ADRs adicionales (pueden coexistir)
  if (!ccFormatDetected) {
    while ((match = adrSectionRegex.exec(raw)) !== null) {
      const id = match[1];
      const afterIdx = match.index + match[0].length;
      // Buscar siguiente ## o fin del archivo
      const nextHeader = raw.substring(afterIdx).match(/^## /m);
      const endIdx = nextHeader ? afterIdx + (nextHeader.index ?? 0) : raw.length;
      sections.push({ header: match[0], body: raw.substring(afterIdx, endIdx).trim() });
    }
  } else {
    // En archivos con formato CC mezclado, extraer también bloques ADR
    while ((match = adrSectionRegex.exec(raw)) !== null) {
      const id = match[1];
      const afterIdx = match.index + match[0].length;
      const nextHeader = raw.substring(afterIdx).match(/^## /m);
      const endIdx = nextHeader ? afterIdx + (nextHeader.index ?? 0) : raw.length;
      sections.push({ header: match[0], body: raw.substring(afterIdx, endIdx).trim() });
    }
  }

  // Procesar cada sección como un posible ADR
  for (const sec of sections) {
    const titleMatch = sec.header.match(/^\[?[Aa][Dd][Rr][-_\s]?\d+\]?\s*-?\s*(.+)$/);
    const contextMatch = /##\s*[Cc]ontext[oó]|####\s*[Cc]ontext[oó]/i.test(sec.body);
    const decisionMatch = /##\s*De[cç]isi[oó]n|####\s*De[cç]isi[oó]n/i.test(sec.body);
    const consequencesMatch = /##\s*C onsecu[ée]nci[aá]s|####\s*C onsecu[ée]nci[aá]s/i.test(sec.body);

    // Solo procesar si hay estructura ADR real (no encabezados vacíos)
    if (!titleMatch) continue;

    const contextRaw = /##\s*[Cc]ontext[oó]|####\s*[Cc]ontext[oó]/i.test(sec.body)
      ? sec.body.split(/(?:^|\n)##\s*[Cc]ontext[oó]/i)[1]?.split(/(?:^|\n)(?:##|###)/)[0]?.trim() ?? ""
      : "";

    const decisionRaw = /##\s*De[cç]isi[oó]n|####\s*De[cç]isi[oó]n/i.test(sec.body)
      ? sec.body.split(/(?:^|\n)##\s*De[cç]isi[oó]n/i)[1]?.split(/(?:^|\n)(?:##|###)/)[0]?.trim() ?? ""
      : "";

    const tags: string[] = [];
    const sourceMatch = /Fuente[: ]+(.+)/i.exec(sec.body);
    const consequenceBody = /##\s*C onsecu[ée]nci[aá]s/i.test(sec.body)
      ? sec.body.split(/(?:^|\n)##\s*C onsecu[ée]nci[aá]s/i)[1]?.split(/(?:^|\n)(?:##|###)/)[0]?.trim() ?? ""
      : "";

    // Detectar archivos relacionados desde el cuerpo
    const filesMatched = sec.body.match(/(?:src|lib|app|components)\/[\w./_-]+\.(ts|tsx|js|jsx)/gi);
    const relatedFiles = filesMatched?.map((f) => f.replace(/^\.\//, "")) ?? [];

    // Extract tags from metadata or common patterns
    if (sourceMatch) tags.push(sourceMatch[1].trim());

    results.push({
      title: titleMatch[1].trim(),
      context: contextRaw || decisionRaw || sec.body.slice(0, 200),
      date: "",
      tags,
      relatedFiles: [...new Set(relatedFiles)],
    });
  }

  // --- Formato 3: ADR individual por archivo (sin sección) ---
  // Si el archivo entero es un único ADR sin división en secciones
  if (sections.length <= 1) {
    const singleAdr = tryParseSingleAdrFile(raw, relPath);
    if (singleAdr) results.push(singleAdr);
  }

  return results;
}

/** Nombre de la última parte de una ruta. */
function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Intenta parsear un archivo completo como un único ADR (cuando no tiene
 * divisiones claras en secciones).
 */
function tryParseSingleAdrFile(raw: string, relPath: string): RawADR | null {
  // Verificar si parece un ADR individual
  const hasAdTitle = /^#\s+[Aa][Dd][Rr][-_\s]?\d+/im.test(raw);
  const hasContext = /##+.*[Cc]ontext(o|[ó])|[*]{2}[Cc]ontext[oó][*]{2}/i.test(raw);
  const hasDecision = /##+.*[Dd]ecisi(o|[ó])n|[*]{2}[Dd]ecisi[oó]n[*]{2}/i.test(raw);

  if (!hasAdTitle && !(hasContext && hasDecision)) return null;

  // Extraer título
  const titleMatch = /^#\s+[Aa][Dd][Rr][-_\s]?\d+\s*[-:]?\s*(.+)$/m.exec(raw);
  const title = titleMatch?.[1]?.trim() ?? basename(relPath).replace(/\.(md)$/, "").replace(/[-_]?\d+$/, "");

  // Extraer contexto y decisión usando extractSubsection helper
  function extractSection(text: string, pattern: string): string | undefined {
    const re = new RegExp(`(?:^|\\n)#{1,3}\\s*${pattern}(?:\\s*:)?`, "i");
    const m = re.exec(text);
    if (!m) return undefined;
    const start = m.index + m[0].length;
    const nextH = text.substring(start).match(/^#{1,3} /m);
    const end = nextH ? start + (nextH.index ?? 0) : text.length;
    return text.substring(start, end).trim();
  }

  const contextRaw = hasContext
    ? extractSection(raw, "[Cc]ontext(o|[ó])") ?? raw.slice(0, 150)
    : raw.slice(0, 150);

  const decisionRaw = hasDecision
    ? extractSection(raw, "[Dd]ecisi(o|[ó])n") ?? contextRaw.slice(0, 100)
    : contextRaw.slice(0, 100);

  // Detectar archivos relacionados
  const filesMatched = raw.match(/(?:src|lib|app|components)\/[\w./_-]+\.(ts|tsx|js|jsx)/gi);
  const relatedFiles = filesMatched?.map((f) => f.replace(/^\.\//, "")) ?? [];

  return {
    title,
    context: contextRaw,
    date: "",
    tags: ["adr"],
    relatedFiles: [...new Set(relatedFiles)],
  };
}
