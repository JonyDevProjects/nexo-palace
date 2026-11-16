/**
 * Nexo-Palace Engine — Extractor de HTML y plantillas Angular / Web.
 */
import { dirname, resolve } from "node:path";
import { extractRequirementIds } from "../markdown.ts";
import { repoRelative } from "../util.ts";
import type {
  ExtractedFile,
  ExtractedSymbol,
  ExtractorContext,
  LanguageExtractor,
} from "./types.ts";

/** Extrae el comentario de cabecera HTML. */
export function htmlHeaderComment(text: string): string {
  const match = /^\s*<!--([\s\S]*?)-->/.exec(text);
  if (!match) return "";
  return match[1].trim();
}

/** Extrae los símbolos representativos de una plantilla HTML (componentes y referencias). */
function extractHtmlSymbols(text: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = text.split("\n");
  const seen = new Set<string>();

  // 1. Etiquetas de componentes personalizados (ej. <app-login>, <p-button>, <router-outlet>)
  const tagRegex = /<([a-z0-9]+-[a-z0-9-]+)(?:\s+[^>]*)?>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const tagName = match[1].toLowerCase();
    if (seen.has(tagName)) continue;
    seen.add(tagName);

    const offset = match.index;
    const line = text.slice(0, offset).split("\n").length;
    const bodyReqIds = extractRequirementIds(match[0]);

    symbols.push({
      name: tagName,
      kind: "component-tag",
      signature: `<${tagName}>`,
      doc: `Instancia de componente <${tagName}> en plantilla`,
      reqIds: [],
      bodyReqIds,
      line,
    });
  }

  // 2. Referencias de plantilla (#ref) y formularios (<form #loginForm="ngForm">)
  const refRegex = /<[a-z0-9-]+[^>]*\s+#([a-zA-Z0-9_-]+)(?:="([^"]*)")?[^>]*>/gi;
  while ((match = refRegex.exec(text)) !== null) {
    const refName = `#${match[1]}`;
    if (seen.has(refName)) continue;
    seen.add(refName);

    const offset = match.index;
    const line = text.slice(0, offset).split("\n").length;
    const refType = match[2] ? `="${match[2]}"` : "";

    symbols.push({
      name: refName,
      kind: "template-ref",
      signature: `${refName}${refType}`,
      doc: `Referencia de plantilla ${refName}`,
      reqIds: [],
      bodyReqIds: [],
      line,
    });
  }

  return symbols;
}

/**
 * Busca dependencias en la plantilla HTML:
 *   - Componente TypeScript homónimo (ej. foo.component.html -> foo.component.ts)
 *   - Estilos homónimos (ej. foo.component.html -> foo.component.scss / .css)
 *   - Enlaces <link href="..."> y <script src="...">
 */
function collectHtmlImports(
  filePath: string,
  text: string,
  knownPaths: Set<string>,
): string[] {
  const imports = new Set<string>();
  const dir = dirname(filePath);

  // Companion component TypeScript
  if (filePath.endsWith(".component.html")) {
    const tsCompanion = filePath.replace(/\.component\.html$/, ".component.ts");
    const relTs = repoRelative(tsCompanion);
    if (knownPaths.has(relTs)) {
      imports.add(relTs);
    }
  }

  // Companion styles
  for (const styleExt of [".scss", ".css", ".less"]) {
    const companionStyle = filePath.replace(/\.html$/, styleExt);
    const relStyle = repoRelative(companionStyle);
    if (knownPaths.has(relStyle)) {
      imports.add(relStyle);
    }
  }

  // Links y scripts relativos
  const linkRegex = /<(?:link|script)[^>]+(?:href|src)=["']([^"']+)["']/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(text)) !== null) {
    const spec = linkMatch[1];
    if (spec.startsWith("http://") || spec.startsWith("https://") || spec.startsWith("//")) {
      continue;
    }
    const resolved = resolve(dir, spec);
    const rel = repoRelative(resolved);
    if (knownPaths.has(rel)) {
      imports.add(rel);
    }
  }

  return Array.from(imports);
}

/**
 * Extractor para HTML y plantillas Angular / Web.
 */
export class HtmlExtractor implements LanguageExtractor {
  readonly name = "html";
  readonly extensions = [".html", ".htm"] as const;

  extract(
    filePath: string,
    fileContent: string,
    context: ExtractorContext,
  ): ExtractedFile {
    const relPath = repoRelative(filePath);
    const headerComment = htmlHeaderComment(fileContent);
    const fileReqIds = extractRequirementIds(fileContent);
    const symbols = extractHtmlSymbols(fileContent);
    const importTargets = collectHtmlImports(filePath, fileContent, context.knownPaths);

    return {
      relPath,
      headerComment,
      fileReqIds,
      symbols,
      importTargets,
    };
  }
}
