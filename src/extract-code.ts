/**
 * Nexo-Palace Engine — extractor de código y grafo de trazabilidad (Fase 2).
 *
 * Usa `ts-morph` para recorrer `app/`, `components/`, `lib/` y los directorios
 * de test, y de ahí obtiene:
 *   * nodos de archivo y de símbolo (funciones, clases, componentes exportados);
 *   * aristas `implements` a requisitos, leídos de los comentarios del código;
 *   * aristas `tests` de los tests a los módulos que importan;
 *   * aristas `depends_on` a partir de los imports reales;
 *   * aristas `references` desde los documentos que citan rutas de código;
 *   * aristas `governed_by` desde las convenciones de taste que citan símbolos.
 *
 * El grafo se construye sobre evidencia observable en el repositorio: rutas
 * citadas, imports reales, identificadores de épica en comentarios. Ninguna
 * relación se infiere del significado del texto.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
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
import { extractRequirementIds } from "./markdown.ts";
import { isMarkdown, repoRelative, walkFiles } from "./util.ts";

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

/** Un símbolo de código exportado. */
interface SymbolInfo {
  name: string;
  kind: string;
  signature: string;
  doc: string;
  /** Requisitos citados en el comentario de documentación del símbolo. */
  reqIds: string[];
  /** Requisitos citados dentro del cuerpo del símbolo (comentarios JSX, etc.). */
  bodyReqIds: string[];
  line: number;
}

/** Hash determinista de contenido (djb2 en hexadecimal). */
function hashContent(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Detecta si una ruta corresponde a un archivo de test. */
function isTestPath(relPath: string): boolean {
  if (/^(tests|test|e2e)\//.test(relPath)) return true;
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath);
}

/**
 * Extrae el comentario de cabecera de un archivo.
 * `SourceFile.getLeadingCommentRanges()` no devuelve el comentario inicial
 * del fichero, así que se lee del texto plano.
 */
function fileHeaderComment(text: string): string {
  const match = /^\s*(\/\*\*[\s\S]*?\*\/|\/\/[^\n]*)/.exec(text);
  if (!match) return "";
  return leadingDoc(match[1]);
}

/** Extrae el comentario de documentación que precede a un nodo AST. */
function leadingDoc(text: string): string {
  return text
    .replace(/^\s*\/\*\*?/g, "")
    .replace(/\*\/\s*$/g, "")
    .replace(/^\s*\*\s?/gm, "")
    .trim();
}

/** Construye la firma textual de una función exportada. */
function functionSignature(fn: ReturnType<SourceFile["getFunctions"]>[number]): string {
  try {
    const params = fn.getParameters().map((p) => p.getText()).join(", ");
    const ret = fn.getReturnType().getText(fn).replace(/\s+/g, " ");
    return `${fn.getName()}(${params}): ${ret}`;
  } catch {
    return fn.getName() ?? "<anónimo>";
  }
}

/** Extrae símbolos exportados de un archivo TypeScript. */
function extractSymbols(sf: SourceFile): SymbolInfo[] {
  const out: SymbolInfo[] = [];

  for (const fn of sf.getFunctions()) {
    if (!fn.isExported()) continue;
    const name = fn.getName() ?? "<anónimo>";
    const doc = leadingDoc(fn.getLeadingCommentRanges().map((r) => r.getText()).join("\n"));
    const docReqIds = extractRequirementIds(`${doc}\n${name}`);
    const bodyReqIds = extractRequirementIds(fn.getText()).filter((id) => !docReqIds.includes(id));
    out.push({
      name,
      kind: "function",
      signature: functionSignature(fn),
      doc,
      reqIds: docReqIds,
      bodyReqIds,
      line: fn.getStartLineNumber(),
    });
  }

  for (const cls of sf.getClasses()) {
    if (!cls.isExported()) continue;
    const name = cls.getName() ?? "<anónimo>";
    const doc = leadingDoc(cls.getLeadingCommentRanges().map((r) => r.getText()).join("\n"));
    const docReqIds = extractRequirementIds(`${doc}\n${name}`);
    out.push({
      name,
      kind: "class",
      signature: `class ${name}`,
      doc,
      reqIds: docReqIds,
      bodyReqIds: extractRequirementIds(cls.getText()).filter((id) => !docReqIds.includes(id)),
      line: cls.getStartLineNumber(),
    });
  }

  // Componentes y constantes exportadas (`export const X = (...) => ...`).
  for (const declaration of sf.getVariableDeclarations()) {
    const isExported = declaration.getVariableStatement()?.isExported() ?? false;
    if (!isExported) continue;
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const isArrow = initializer.getKind() === SyntaxKind.ArrowFunction;
    const isComponent = /^[A-Z]/.test(declaration.getName());
    if (!isArrow && !isComponent) continue;

    const varName = declaration.getName();
    const doc = leadingDoc(declaration.getLeadingCommentRanges().map((r) => r.getText()).join("\n"));
    let typeText = "unknown";
    try {
      typeText = declaration.getType().getText(declaration).replace(/\s+/g, " ").slice(0, 300);
    } catch {
      typeText = "unknown";
    }
    const docReqIds = extractRequirementIds(`${doc}\n${varName}`);
    let bodyText = "";
    try {
      bodyText = declaration.getText();
    } catch {
      bodyText = "";
    }
    out.push({
      name: varName,
      kind: isComponent ? "component" : "const",
      signature: `${varName}: ${typeText}`,
      doc,
      reqIds: docReqIds,
      bodyReqIds: extractRequirementIds(bodyText).filter((id) => !docReqIds.includes(id)),
      line: declaration.getStartLineNumber(),
    });
  }

  // Deduplicar por nombre (una función y una variable pueden coincidir).
  const seen = new Set<string>();
  return out.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

/** Detecta los paths de código citados dentro de un texto. */
function findCodePaths(text: string, knownPaths: Set<string>): string[] {
  const found = new Set<string>();
  const re = /(?:^|[\s`("'\[])((?:app|components|lib|tests|test|e2e|scripts|data)\/[\w./-]+\.[cm]?[jt]sx?)/g;
  for (const match of text.matchAll(re)) {
    const candidate = match[1];
    if (knownPaths.has(candidate)) found.add(candidate);
  }
  return Array.from(found);
}

/**
 * Recoge las rutas de los módulos importados por un archivo.
 * Se capturan tanto los imports estáticos como los dinámicos
 * (`await import("...")`), que son comunes en los tests de este proyecto.
 * Solo se devuelven las que pertenecen al proyecto (no `node_modules`).
 */
function collectImportTargets(sf: SourceFile, knownPaths: Set<string>): string[] {
  const out = new Set<string>();

  const add = (absPath: string): void => {
    const rel = repoRelative(absPath);
    if (knownPaths.has(rel)) out.add(rel);
  };

  for (const imp of sf.getImportDeclarations()) {
    const target = imp.getModuleSpecifierSourceFile();
    if (target) add(target.getFilePath());
  }

  // Imports dinámicos: `await import("./modulo")`.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const [arg] = call.getArguments();
    if (!arg || arg.getKind() !== SyntaxKind.StringLiteral) continue;
    const specifier = (arg as import("ts-morph").StringLiteral).getLiteralValue();
    const resolved = resolveRelativeImport(sf, specifier);
    if (resolved) add(resolved);
  }

  return Array.from(out);
}

/** Resuelve un especificador de import relativo a un fichero del proyecto. */
function resolveRelativeImport(sf: SourceFile, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const dir = dirname(sf.getFilePath());
  const base = resolve(dir, specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Extrae el grafo de código y lo escribe en la base.
 */
export async function extractCode(
  provider: EmbeddingProvider,
  options: { db?: Db; allowProviderSwitch?: boolean } = {},
): Promise<CodeExtractResult> {
  const db = options.db ?? openDb();
  const errors: string[] = [];

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

  // --- Parseo con ts-morph -------------------------------------------------
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      jsx: 4,
      target: 99,
      // El proyecto usa el alias `@/...`; sin esto las dependencias de los
      // componentes no se resolverían y el grafo de imports quedaría vacío.
      baseUrl: root,
      paths: { "@/*": ["./*"] },
    },
  });
  project.addSourceFilesAtPaths(files);

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

  for (const sf of project.getSourceFiles()) {
    const relPath = repoRelative(sf.getFilePath());
    if (!knownPaths.has(relPath)) continue;

    const isTest = isTestPath(relPath);
    const nodeType = isTest ? "test" : "code";
    const fileNodeId = `code:${relPath}`;
    fileNodeIds.add(fileNodeId);
    if (isTest) testCount++;

    const fileText = sf.getFullText();
    const headerComment = fileHeaderComment(sf.getFullText());
    const fileReqIds = extractRequirementIds(headerComment);

    const symbols = extractSymbols(sf);

    upsertNode(db, {
      id: fileNodeId,
      type: nodeType,
      path: relPath,
      name: relPath.split("/").pop() ?? relPath,
      status: "active",
      title: symbols.length > 0 ? symbols.map((s) => s.name).join(", ") : relPath,
      meta: {
        kind: "file",
        symbolCount: symbols.length,
        requirementIds: fileReqIds,
      },
      updatedAt: new Date().toISOString(),
    });

    // Fragmento resumen del archivo.
    const headerDoc = headerComment;
    const fileSummary = [
      `Archivo: ${relPath}`,
      headerDoc ? `Descripción: ${headerDoc}` : "",
      symbols.length > 0 ? `Exporta: ${symbols.map((s) => s.name).join(", ")}` : "",
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
        requirementIds: fileReqIds,
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

    for (const symbol of symbols) {
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

      // Requisitos citados dentro del cuerpo del símbolo (comentarios JSX).
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
    for (const reqId of fileReqIds) {
      upsertEdge(db, {
        sourceId: fileNodeId,
        targetId: ensureRequirementNode(db, reqId, relPath),
        relation: "implements",
        confidence: 0.8,
        meta: { via: "file-header" },
      });
      edgeCount++;
    }

    // Se registran los imports para el segundo pase: las aristas `depends_on`
    // solo pueden crearse cuando todos los nodos de archivo existen.
    importsByFile.push({ relPath, imports: collectImportTargets(sf, knownPaths) });
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

  for (const row of codeChunks) {
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
