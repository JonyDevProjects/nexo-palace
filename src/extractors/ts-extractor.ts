/**
 * Nexo-Palace Engine — Extractor de TypeScript / JavaScript mediante ts-morph.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { extractRequirementIds } from "../markdown.ts";
import { repoRelative } from "../util.ts";
import type {
  ExtractedFile,
  ExtractedSymbol,
  ExtractorContext,
  LanguageExtractor,
} from "./types.ts";

/**
 * Extrae el comentario de cabecera de un archivo.
 */
export function fileHeaderComment(text: string): string {
  const match = /^\s*(\/\*\*[\s\S]*?\*\/|\/\/[^\n]*)/.exec(text);
  if (!match) return "";
  return leadingDoc(match[1]);
}

/** Extrae el comentario de documentación que precede a un nodo AST. */
export function leadingDoc(text: string): string {
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
function extractSymbols(sf: SourceFile): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = [];

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
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.mts`,
    `${base}.cts`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.js"),
    join(base, "index.mjs"),
    join(base, "index.cjs"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Recoge las rutas de los módulos importados por un archivo TypeScript/JavaScript.
 * Incluye imports estáticos, dinámicos y dependencias de plantillas/estilos Angular (@Component).
 */
function collectImportTargets(sf: SourceFile, knownPaths: Set<string>): string[] {
  const out = new Set<string>();
  const filePath = sf.getFilePath();
  const dir = dirname(filePath);

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

  // Detección de metadatos Angular en componentes (@Component({ templateUrl, styleUrls }))
  const fullText = sf.getFullText();
  const tmplMatch = /templateUrl:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = tmplMatch.exec(fullText)) !== null) {
    const tmplPath = resolve(dir, m[1]);
    add(tmplPath);
  }

  const styleMatch = /(?:styleUrls:\s*\[([^\]]+)\]|styleUrl:\s*['"]([^'"]+)['"])/g;
  while ((m = styleMatch.exec(fullText)) !== null) {
    const rawList = m[1] ?? m[2] ?? "";
    const stylePaths = rawList.match(/['"]([^'"]+)['"]/g) ?? [];
    for (const s of stylePaths) {
      const cleanPath = s.replace(/['"]/g, "");
      add(resolve(dir, cleanPath));
    }
  }

  // Si es un componente Angular (*.component.ts), enlazar companion files implícitos
  if (filePath.endsWith(".component.ts")) {
    const companionHtml = filePath.replace(/\.component\.ts$/, ".component.html");
    add(companionHtml);
    for (const styleExt of [".scss", ".css", ".less"]) {
      const companionStyle = filePath.replace(/\.component\.ts$/, `.component${styleExt}`);
      add(companionStyle);
    }
  }

  return Array.from(out);
}

/**
 * Extractor para TypeScript y JavaScript soportado por ts-morph.
 */
export class TsExtractor implements LanguageExtractor {
  readonly name = "typescript";
  readonly extensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
  ] as const;
  private project?: Project;

  init(files: string[], context: ExtractorContext): void {
    const tsFiles = files.filter((f) =>
      this.extensions.some((ext) => f.toLowerCase().endsWith(ext)),
    );
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        target: 99,
        baseUrl: context.root,
        paths: { "@/*": ["./*"] },
      },
    });
    this.project.addSourceFilesAtPaths(tsFiles);
  }

  extract(
    filePath: string,
    fileContent: string,
    context: ExtractorContext,
  ): ExtractedFile {
    let sf = this.project?.getSourceFile(filePath);
    if (!sf) {
      if (!this.project) {
        this.project = new Project({
          skipAddingFilesFromTsConfig: true,
          compilerOptions: {
            allowJs: true,
            jsx: 4,
            target: 99,
            baseUrl: context.root,
            paths: { "@/*": ["./*"] },
          },
        });
      }
      sf = this.project.createSourceFile(filePath, fileContent, { overwrite: true });
    }

    const relPath = repoRelative(filePath);
    const headerComment = fileHeaderComment(fileContent);
    const fileReqIds = extractRequirementIds(headerComment);
    const symbols = extractSymbols(sf);
    const importTargets = collectImportTargets(sf, context.knownPaths);

    return {
      relPath,
      headerComment,
      fileReqIds,
      symbols,
      importTargets,
    };
  }
}
