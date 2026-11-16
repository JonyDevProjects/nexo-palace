/**
 * Nexo-Palace Engine — Extractor de estilos CSS, SCSS y Less.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { extractRequirementIds } from "../markdown.ts";
import { repoRelative } from "../util.ts";
import type {
  ExtractedFile,
  ExtractedSymbol,
  ExtractorContext,
  LanguageExtractor,
} from "./types.ts";

/** Extrae el comentario inicial de un fichero de estilos. */
export function cssHeaderComment(text: string): string {
  const match = /^\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/.exec(text);
  if (!match) return "";
  return match[1].replace(/^\s*(\/\*|\/\/|\*)\s?/gm, "").replace(/\*\/\s*$/, "").trim();
}

/** Extrae clases, mixins y keyframes de un archivo de estilos. */
function extractCssSymbols(text: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const seen = new Set<string>();

  // 1. Mixins de SCSS/Less: @mixin name / .mixinName(...)
  const mixinRegex = /@mixin\s+([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = mixinRegex.exec(text)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);

    const line = text.slice(0, match.index).split("\n").length;
    symbols.push({
      name,
      kind: "mixin",
      signature: `@mixin ${name}`,
      doc: `SCSS Mixin: ${name}`,
      reqIds: [],
      bodyReqIds: [],
      line,
    });
  }

  // 2. Keyframes de animaciones: @keyframes name
  const keyframesRegex = /@keyframes\s+([a-zA-Z0-9_-]+)/g;
  while ((match = keyframesRegex.exec(text)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);

    const line = text.slice(0, match.index).split("\n").length;
    symbols.push({
      name,
      kind: "keyframes",
      signature: `@keyframes ${name}`,
      doc: `Animación @keyframes: ${name}`,
      reqIds: [],
      bodyReqIds: [],
      line,
    });
  }

  // 3. Clases CSS principales: .class-name {
  const classRegex = /(?:^|\n)\s*(\.[a-zA-Z0-9_-]+)(?:\s*,\s*\.[a-zA-Z0-9_-]+)*\s*\{/g;
  while ((match = classRegex.exec(text)) !== null) {
    const className = match[1].trim();
    if (seen.has(className) || className.length < 2) continue;
    seen.add(className);

    const line = text.slice(0, match.index).split("\n").length;
    symbols.push({
      name: className,
      kind: "class",
      signature: className,
      doc: `Selector de clase: ${className}`,
      reqIds: [],
      bodyReqIds: [],
      line,
    });
  }

  return symbols;
}

/**
 * Resuelve imports relativos de estilos:
 *   - @import "path"
 *   - @use "path"
 *   - @forward "path"
 *   - Vinculación con componente companion Angular (foo.component.scss -> foo.component.ts)
 */
function collectCssImports(
  filePath: string,
  text: string,
  knownPaths: Set<string>,
): string[] {
  const imports = new Set<string>();
  const dir = dirname(filePath);

  // Companion component TypeScript
  if (/\.component\.(scss|css|less)$/.test(filePath)) {
    const companionTs = filePath.replace(/\.component\.(scss|css|less)$/, ".component.ts");
    const relTs = repoRelative(companionTs);
    if (knownPaths.has(relTs)) {
      imports.add(relTs);
    }
  }

  // Directivas @import, @use, @forward
  const importRegex = /@(import|use|forward)\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(text)) !== null) {
    const spec = match[2];
    if (spec.startsWith("http://") || spec.startsWith("https://") || spec.startsWith("~")) {
      continue;
    }
    const base = resolve(dir, spec);
    const candidates = [
      base,
      `${base}.scss`,
      `${base}.css`,
      `${base}.less`,
      join(dirname(base), `_${base.split("/").pop()}.scss`),
    ];

    for (const cand of candidates) {
      const rel = repoRelative(cand);
      if (knownPaths.has(rel)) {
        imports.add(rel);
        break;
      }
    }
  }

  return Array.from(imports);
}

/**
 * Extractor para estilos CSS, SCSS, Sass y Less.
 */
export class CssExtractor implements LanguageExtractor {
  readonly name = "css";
  readonly extensions = [".css", ".scss", ".sass", ".less"] as const;

  extract(
    filePath: string,
    fileContent: string,
    context: ExtractorContext,
  ): ExtractedFile {
    const relPath = repoRelative(filePath);
    const headerComment = cssHeaderComment(fileContent);
    const fileReqIds = extractRequirementIds(fileContent);
    const symbols = extractCssSymbols(fileContent);
    const importTargets = collectCssImports(filePath, fileContent, context.knownPaths);

    return {
      relPath,
      headerComment,
      fileReqIds,
      symbols,
      importTargets,
    };
  }
}
