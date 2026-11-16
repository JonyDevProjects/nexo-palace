/**
 * Nexo-Palace Engine — extractor de código y grafo de trazabilidad políglota (Fase 2).
 *
 * Utiliza un registro de extractores de lenguaje (TypeScript con ts-morph,
 * Python con tree-sitter, etc.) para procesar el código fuente del proyecto y
 * construir el grafo de trazabilidad con:
 *   * nodos de archivo y de símbolo (funciones, clases, componentes exportados);
 *   * aristas `implements` a requisitos, leídos de comentarios y docstrings;
 *   * aristas `tests` de los tests a los módulos que importan;
 *   * aristas `depends_on` a partir de los imports reales;
 *   * aristas `references` desde los documentos que citan rutas de código;
 *   * aristas `governed_by` desde las convenciones de taste que citan símbolos.
 *
 * El grafo se construye sobre evidencia observable en el repositorio: rutas
 * citadas, imports reales, identificadores de épica en comentarios. Ninguna
 * relación se infiere del significado del texto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig, MIN_EMBED_CHARS, projectRoot } from "./config.ts";
import {
  type Db,
  deleteNode,
  ensureRequirementNode,
  ensureVecTable,
  insertVector,
  openDb,
  replaceChunks,
  upsertEdge,
  upsertNode,
} from "./db.ts";
import { type EmbeddingProvider } from "./embedder.ts";
import {
  createDefaultRegistry,
  ExtractorRegistry,
  type ExtractedFile,
  type ExtractedSymbol,
  type LanguageExtractor,
} from "./extractors/index.ts";
import { repoRelative, walkFiles } from "./util.ts";

/** Resumen de la extracción de código. */
export interface CodeExtractResult {
  files: number;
  symbols: number;
  tests: number;
  edges: number;
  chunks: number;
  vectors: number;
  errors: string[];
}

/** Alias retrocompatible para símbolos extraídos. */
export type SymbolInfo = ExtractedSymbol;
export type { ExtractedFile, ExtractedSymbol, LanguageExtractor };
export { ExtractorRegistry, createDefaultRegistry };

/** Hash determinista de contenido (djb2 en hexadecimal). */
export function hashContent(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Detecta si una ruta corresponde a un archivo de test. */
export function isTestPath(relPath: string): boolean {
  if (/^(tests|test|e2e)\//.test(relPath)) return true;
  if (/(?:^|\/)(?:tests|test|e2e|backend-e2e|frontend-e2e|__tests__)\//.test(relPath)) return true;
  if (/\.(test|spec)\.(?:[cm]?[jt]sx?|py|html|css|scss|sql)$/.test(relPath)) return true;
  if (/(?:^|\/)(?:test_[^/]+\.py|[^/]+_test\.py)$/.test(relPath)) return true;
  return false;
}

/** Detecta los paths de código citados dentro de un texto. */
export function findCodePaths(text: string, knownPaths: Set<string>): string[] {
  const found = new Set<string>();
  const re = /(?:^|[\s`("'\[])([\w./-]+\.(?:[cm]?[jt]sx?|py|html|css|scss|less|sql))/g;
  for (const match of text.matchAll(re)) {
    const candidate = match[1].replace(/^[./]+/, "");
    if (knownPaths.has(candidate)) found.add(candidate);
  }
  return Array.from(found);
}

/**
 * Extrae el grafo de código y lo escribe en la base de datos.
 */
export async function extractCode(
  provider: EmbeddingProvider,
  options: {
    db?: Db;
    allowProviderSwitch?: boolean;
    onProgress?: (current: number, total: number, message: string) => void;
    registry?: ExtractorRegistry;
  } = {},
): Promise<CodeExtractResult> {
  const db = options.db ?? openDb();
  const errors: string[] = [];
  const registry = options.registry ?? createDefaultRegistry();

  // --- Recolectar archivos -------------------------------------------------
  const files: string[] = [];
  const root = projectRoot();
  const config = getConfig();
  for (const dir of config.codeDirs) {
    walkFiles(
      join(root, dir),
      (f) => config.codeExtensions.includes(f.slice(f.lastIndexOf("."))),
      files,
    );
  }
  files.sort();

  const relPaths = files.map((f) => repoRelative(f));
  const knownPaths = new Set(relPaths);
  const context = { root, knownPaths, codeDirs: config.codeDirs };

  // --- Inicializar extractores con los archivos correspondientes -----------
  const filesByExtractor = new Map<LanguageExtractor, string[]>();
  for (const file of files) {
    const extractor = registry.getExtractorForPath(file);
    if (!extractor) continue;
    let list = filesByExtractor.get(extractor);
    if (!list) {
      list = [];
      filesByExtractor.set(extractor, list);
    }
    list.push(file);
  }

  for (const [extractor, extractorFiles] of filesByExtractor) {
    if (extractor.init) {
      await extractor.init(extractorFiles, context);
    }
  }

  ensureVecTable(db, provider.dim, provider.name, {
    allowSwitch: options.allowProviderSwitch,
  });

  const fileNodeIds = new Set<string>();
  let symbolCount = 0;
  let testCount = 0;
  let edgeCount = 0;
  let chunkCount = 0;
  let vectorCount = 0;

  const chunkTexts: string[] = [];
  const importsByFile: Array<{ relPath: string; imports: string[] }> = [];
  let processedFiles = 0;

  for (const file of files) {
    const relPath = repoRelative(file);
    const extractor = registry.getExtractorForPath(file);
    if (!extractor) continue;

    processedFiles++;
    if (options.onProgress) {
      options.onProgress(processedFiles, files.length, relPath);
    }

    let fileText = "";
    try {
      fileText = readFileSync(file, "utf8");
    } catch (err) {
      errors.push(`${relPath}: ${(err as Error).message}`);
      continue;
    }

    let extracted: ExtractedFile;
    try {
      extracted = await extractor.extract(file, fileText, context);
    } catch (err) {
      errors.push(`${relPath}: ${(err as Error).message}`);
      continue;
    }

    const isTest = isTestPath(relPath);
    const nodeType = isTest ? "test" : "code";
    const fileNodeId = `code:${relPath}`;
    fileNodeIds.add(fileNodeId);
    if (isTest) testCount++;

    upsertNode(db, {
      id: fileNodeId,
      type: nodeType,
      path: relPath,
      name: relPath.split("/").pop() ?? relPath,
      status: "active",
      title: extracted.symbols.length > 0 ? extracted.symbols.map((s) => s.name).join(", ") : relPath,
      meta: {
        kind: "file",
        symbolCount: extracted.symbols.length,
        requirementIds: extracted.fileReqIds,
      },
      updatedAt: new Date().toISOString(),
    });

    // Fragmento resumen del archivo.
    const headerDoc = extracted.headerComment;
    const fileSummary = [
      `Archivo: ${relPath}`,
      headerDoc ? `Descripción: ${headerDoc}` : "",
      extracted.symbols.length > 0 ? `Exporta: ${extracted.symbols.map((s) => s.name).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    chunkTexts.push(fileSummary);
    replaceChunks(db, fileNodeId, [
      {
        id: `chunk:${relPath}`,
        nodeId: fileNodeId,
        seq: 0,
        content: fileSummary,
        headerPath: relPath,
        requirementIds: extracted.fileReqIds,
        contentHash: hashContent(fileSummary),
      },
    ]);

    // Nodos y fragmentos de símbolo.
    const symbolChunks: Array<{
      id: string;
      nodeId: string;
      seq: number;
      content: string;
      headerPath: string;
      requirementIds: string[];
      contentHash: string;
    }> = [];

    for (const symbol of extracted.symbols) {
      const symNodeId = `sym:${relPath}#${symbol.name}`;
      symbolCount++;

      upsertNode(db, {
        id: symNodeId,
        type: "symbol",
        path: relPath,
        name: symbol.name,
        status: "active",
        title: `${symbol.kind} ${symbol.name}`,
        meta: {
          kind: symbol.kind,
          signature: symbol.signature,
          line: symbol.line,
          requirementIds: symbol.reqIds,
        },
        updatedAt: new Date().toISOString(),
      });

      upsertEdge(db, {
        sourceId: fileNodeId,
        targetId: symNodeId,
        relation: "contains",
        confidence: 1,
      });

      const symText = [
        `${relPath} — ${symbol.kind} ${symbol.name}`,
        symbol.doc ? `Doc: ${symbol.doc}` : "",
        `Firma: ${symbol.signature}`,
      ]
        .filter(Boolean)
        .join("\n");
      chunkTexts.push(symText);
      symbolChunks.push({
        id: `chunk:${relPath}#${symbol.name}`,
        nodeId: symNodeId,
        seq: 0,
        content: symText,
        headerPath: `${relPath} — ${symbol.name}`,
        requirementIds: symbol.reqIds,
        contentHash: hashContent(symText),
      });

      // Requisitos citados en el comentario de documentación del símbolo.
      for (const reqId of symbol.reqIds) {
        upsertEdge(db, {
          sourceId: symNodeId,
          targetId: ensureRequirementNode(db, reqId, relPath),
          relation: "implements",
          confidence: 1,
          meta: { via: "doc-comment" },
        });
        edgeCount++;
      }

      // Requisitos citados dentro del cuerpo del símbolo (comentarios JSX / cuerpo).
      for (const reqId of symbol.bodyReqIds) {
        upsertEdge(db, {
          sourceId: symNodeId,
          targetId: ensureRequirementNode(db, reqId, relPath),
          relation: "implements",
          confidence: 0.8,
          meta: { via: "body-comment" },
        });
        edgeCount++;
      }
    }

    if (symbolChunks.length > 0) {
      for (const sym of symbolChunks) {
        replaceChunks(db, sym.nodeId, [sym]);
      }
    }

    // Requisitos citados a nivel de archivo.
    for (const reqId of extracted.fileReqIds) {
      upsertEdge(db, {
        sourceId: fileNodeId,
        targetId: ensureRequirementNode(db, reqId, relPath),
        relation: "implements",
        confidence: 0.8,
        meta: { via: "file-header" },
      });
      edgeCount++;
    }

    // Se registran los imports para el segundo pase.
    importsByFile.push({ relPath, imports: extracted.importTargets });
  }

  // --- Pase 2: dependencias entre módulos (imports reales) ----------------
  for (const { relPath, imports } of importsByFile) {
    for (const targetRel of imports) {
      upsertEdge(db, {
        sourceId: `code:${relPath}`,
        targetId: `code:${targetRel}`,
        relation: "depends_on",
        confidence: 1,
        meta: { via: "import" },
      });
      edgeCount++;
    }
  }

  // --- Aristas test → código (por import real) ----------------------------
  for (const { relPath, imports } of importsByFile) {
    if (!isTestPath(relPath)) continue;
    for (const targetRel of imports) {
      // Un test no "testea" a otro test.
      if (isTestPath(targetRel)) continue;
      upsertEdge(db, {
        sourceId: `code:${relPath}`,
        targetId: `code:${targetRel}`,
        relation: "tests",
        confidence: 1,
        meta: { via: "import" },
      });
      edgeCount++;
    }
  }

  // --- Aristas documento → código (rutas citadas en la documentación) ------
  const docNodes = db.prepare("SELECT id, path FROM nodes WHERE type IN ('doc','taste')").all() as Array<{
    id: string;
    path: string;
  }>;

  for (const doc of docNodes) {
    try {
      const text = readFileSync(join(root, doc.path), "utf8");
      const cited = findCodePaths(text, knownPaths);
      for (const path of cited) {
        upsertEdge(db, {
          sourceId: doc.id,
          targetId: `code:${path}`,
          relation: doc.id.startsWith("doc:") ? "references" : "governed_by",
          confidence: 1,
          meta: { via: "path-mention" },
        });
        edgeCount++;
      }
    } catch (err) {
      errors.push(`${doc.path}: ${(err as Error).message}`);
    }
  }

  // --- Limpieza de nodos de código obsoletos ------------------------------
  const stale = db
    .prepare("SELECT id FROM nodes WHERE type IN ('code','test','symbol')")
    .all() as Array<{ id: string }>;
  for (const row of stale) {
    if (!row.id.startsWith("code:")) continue;
    if (!fileNodeIds.has(row.id)) deleteNode(db, row.id);
  }

  // --- Fragmentos y vectores de código ------------------------------------
  const codeChunks = db
    .prepare(
      `SELECT c.id, c.content, c.node_id FROM chunks c
       JOIN nodes n ON n.id = c.node_id
       WHERE n.type IN ('code','test','symbol')`,
    )
    .all() as Array<{ id: string; content: string; node_id: string }>;

  for (const _row of codeChunks) {
    chunkCount++;
  }

  // Solo se embeben los fragmentos de código cuyo contenido ha cambiado.
  const pending = codeChunks.filter((c) => {
    if (c.content.length < MIN_EMBED_CHARS) return false;
    const row = db
      .prepare("SELECT content_hash FROM chunks WHERE id = ?")
      .get(c.id) as { content_hash: string | null } | undefined;
    if (!row) return true;
    if (row.content_hash !== hashContent(c.content)) return true;
    try {
      return !db.prepare("SELECT 1 AS x FROM chunks_vec WHERE chunk_id = ?").get(c.id);
    } catch {
      return true;
    }
  });

  if (pending.length > 0) {
    const vectors = await provider.embed(pending.map((c) => c.content));
    for (let i = 0; i < vectors.length; i++) {
      insertVector(db, pending[i].id, vectors[i]);
      vectorCount++;
    }
  }

  return {
    files: fileNodeIds.size,
    symbols: symbolCount,
    tests: testCount,
    edges: edgeCount,
    chunks: chunkCount,
    vectors: vectorCount,
    errors,
  };
}
