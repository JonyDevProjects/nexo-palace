/**
 * Nexo-Palace Engine — Extractor de esquemas y scripts SQL.
 */
import { extractRequirementIds } from "../markdown.ts";
import { repoRelative } from "../util.ts";
import type {
  ExtractedFile,
  ExtractedSymbol,
  ExtractorContext,
  LanguageExtractor,
} from "./types.ts";

/** Extrae el comentario inicial de un fichero SQL. */
export function sqlHeaderComment(text: string): string {
  const match = /^\s*(--[^\n]*|\/\*[\s\S]*?\*\/)/.exec(text);
  if (!match) return "";
  return match[1].replace(/^\s*(--|\/\*|\*)\s?/gm, "").replace(/\*\/\s*$/, "").trim();
}

/** Extrae definiciones de tablas, vistas, funciones e índices de un script SQL. */
function extractSqlSymbols(text: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const seen = new Set<string>();

  // 1. CREATE TABLE
  const tableRegex = /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_".]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(text)) !== null) {
    const rawName = match[1].replace(/"/g, "");
    const name = rawName.split(".").pop() ?? rawName;
    if (seen.has(name)) continue;
    seen.add(name);

    const line = text.slice(0, match.index).split("\n").length;
    symbols.push({
      name,
      kind: "table",
      signature: `CREATE TABLE ${name}`,
      doc: `Tabla SQL: ${name}`,
      reqIds: [],
      bodyReqIds: [],
      line,
    });
  }

  // 2. CREATE VIEW
  const viewRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_".]+)/gi;
  while ((match = viewRegex.exec(text)) !== null) {
    const rawName = match[1].replace(/"/g, "");
    const name = rawName.split(".").pop() ?? rawName;
    if (seen.has(name)) continue;
    seen.add(name);

    const line = text.slice(0, match.index).split("\n").length;
    symbols.push({
      name,
      kind: "view",
      signature: `CREATE VIEW ${name}`,
      doc: `Vista SQL: ${name}`,
      reqIds: [],
      bodyReqIds: [],
      line,
    });
  }

  // 3. CREATE FUNCTION / PROCEDURE
  const fnRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_".]+)\s*\(([^)]*)\)/gi;
  while ((match = fnRegex.exec(text)) !== null) {
    const rawName = match[1].replace(/"/g, "");
    const name = rawName.split(".").pop() ?? rawName;
    const params = match[2].trim().replace(/\s+/g, " ");
    const sig = `${name}(${params})`;
    if (seen.has(sig)) continue;
    seen.add(sig);

    const line = text.slice(0, match.index).split("\n").length;
    symbols.push({
      name,
      kind: "function",
      signature: sig,
      doc: `Procedimiento/Función SQL: ${name}`,
      reqIds: [],
      bodyReqIds: [],
      line,
    });
  }

  // 4. CREATE INDEX
  const idxRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_".]+)\s+ON\s+([a-zA-Z0-9_".]+)/gi;
  while ((match = idxRegex.exec(text)) !== null) {
    const rawName = match[1].replace(/"/g, "");
    const name = rawName.split(".").pop() ?? rawName;
    const table = match[2].replace(/"/g, "");
    if (seen.has(name)) continue;
    seen.add(name);

    const line = text.slice(0, match.index).split("\n").length;
    symbols.push({
      name,
      kind: "index",
      signature: `INDEX ${name} ON ${table}`,
      doc: `Índice SQL en ${table}`,
      reqIds: [],
      bodyReqIds: [],
      line,
    });
  }

  return symbols;
}

/**
 * Resuelve dependencias de referencias foráneas entre archivos SQL:
 * Si REFERENCES other_table apunta a una tabla definida en otro archivo SQL conocido.
 */
function collectSqlImports(
  text: string,
  knownPaths: Set<string>,
): string[] {
  const imports = new Set<string>();
  const refRegex = /REFERENCES\s+([a-zA-Z0-9_".]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = refRegex.exec(text)) !== null) {
    const targetTable = match[1].replace(/"/g, "").toLowerCase();
    for (const path of knownPaths) {
      if (!path.endsWith(".sql")) continue;
      const baseName = path.split("/").pop()?.replace(/\.sql$/, "").toLowerCase();
      if (baseName && (baseName === targetTable || baseName.includes(targetTable))) {
        imports.add(path);
      }
    }
  }

  return Array.from(imports);
}

/**
 * Extractor para scripts y esquemas SQL.
 */
export class SqlExtractor implements LanguageExtractor {
  readonly name = "sql";
  readonly extensions = [".sql"] as const;

  extract(
    filePath: string,
    fileContent: string,
    context: ExtractorContext,
  ): ExtractedFile {
    const relPath = repoRelative(filePath);
    const headerComment = sqlHeaderComment(fileContent);
    const fileReqIds = extractRequirementIds(fileContent);
    const symbols = extractSqlSymbols(fileContent);
    const importTargets = collectSqlImports(fileContent, context.knownPaths);

    return {
      relPath,
      headerComment,
      fileReqIds,
      symbols,
      importTargets,
    };
  }
}
