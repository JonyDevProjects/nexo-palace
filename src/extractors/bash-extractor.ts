/**
 * Nexo-Palace Engine — Extractor de scripts Shell / Bash mediante tree-sitter.
 *
 * Analiza archivos .sh, .bash y .zsh para extraer:
 *   - Símbolos (funciones estándar y 'function', variables de entorno y configuración);
 *   - Documentación (comentarios de cabecera y comentarios contiguos #);
 *   - Identificadores de requisitos (@implements RF-XX);
 *   - Dependencias de scripts invocados o enlazados (source, .).
 */
import { dirname, join, normalize, relative, sep } from "node:path";
import Parser from "tree-sitter";
// @ts-ignore - tree-sitter-bash no provee tipos nativos
import Bash from "tree-sitter-bash";
import { projectRoot } from "../config.ts";
import { extractRequirementIds } from "../markdown.ts";
import { repoRelative } from "../util.ts";
import type {
  ExtractedFile,
  ExtractedSymbol,
  ExtractorContext,
  LanguageExtractor,
} from "./types.ts";

/** Limpia comillas envolventes simples o dobles de una cadena. */
function cleanQuotes(text: string): string {
  return text.replace(/^["']|["']$/g, "").trim();
}

/** Extrae comentarios contiguos que preceden inmediatamente a un nodo AST. */
function extractLeadingComments(
  node: Parser.SyntaxNode,
  allChildren: Parser.SyntaxNode[],
  index: number,
): string {
  const comments: string[] = [];
  let prevIdx = index - 1;
  let expectedRow = node.startPosition.row - 1;

  while (prevIdx >= 0) {
    const prev = allChildren[prevIdx];
    if (prev.type === "comment" && prev.endPosition.row === expectedRow) {
      const text = prev.text.trim();
      if (!text.startsWith("#!")) {
        comments.unshift(text.replace(/^#\s?/, ""));
      }
      expectedRow = prev.startPosition.row - 1;
      prevIdx--;
    } else {
      break;
    }
  }

  return comments.join("\n").trim();
}

/** Extrae el comentario de cabecera a nivel de script excluyendo el shebang. */
function extractBashFileHeader(tree: Parser.Tree): { headerDoc: string; fileReqIds: string[] } {
  const comments: string[] = [];

  for (const child of tree.rootNode.children) {
    if (child.type === "comment") {
      const text = child.text.trim();
      if (text.startsWith("#!")) continue;
      comments.push(text.replace(/^#\s?/, ""));
    } else {
      break;
    }
  }

  const combined = comments.join("\n").trim();
  return {
    headerDoc: combined,
    fileReqIds: extractRequirementIds(combined),
  };
}

interface ParsedBashImport {
  rawTarget: string;
}

/**
 * Resuelve sentencias `source` y `.` contra las rutas conocidas del proyecto.
 */
function resolveBashImports(
  sourceRelPath: string,
  imports: ParsedBashImport[],
  knownPaths: Set<string>,
  codeDirs: string[] = ["src", "lib", "app", "tests", "test", "scripts", "bin", "tools"],
): string[] {
  const resolved = new Set<string>();

  const addIfKnown = (candidate: string): void => {
    const norm = normalize(candidate).replace(/^(\.\/|\/)/, "");
    if (knownPaths.has(norm)) {
      resolved.add(norm);
    }
  };

  for (const item of imports) {
    const raw = cleanQuotes(item.rawTarget);
    if (!raw) continue;

    // Limpia referencias a variables comunes de directorio inicial (ej. $DIR/helper.sh, ${ROOT}/lib.sh)
    let clean = raw.replace(/^\$\{?[A-Za-z0-9_]+\}?\/?/, "");
    if (!clean) clean = raw;

    // 1. Relativo al directorio del archivo fuente
    const dir = dirname(sourceRelPath);
    addIfKnown(join(dir, clean));

    // 2. Relativo a la raíz del repositorio
    addIfKnown(clean);

    // 3. Dentro de directorios de código conocidos
    for (const codeDir of codeDirs) {
      addIfKnown(join(codeDir, clean));
    }

    // 4. Probar con extensiones comunes si no tiene extensión
    if (!clean.includes(".")) {
      for (const ext of [".sh", ".bash", ".zsh"]) {
        addIfKnown(join(dir, `${clean}${ext}`));
        addIfKnown(`${clean}${ext}`);
        for (const codeDir of codeDirs) {
          addIfKnown(join(codeDir, `${clean}${ext}`));
        }
      }
    }
  }

  return Array.from(resolved);
}

/**
 * Extractor de funciones, variables y trazabilidad en scripts Shell / Bash.
 */
export class BashExtractor implements LanguageExtractor {
  readonly name = "bash";
  readonly extensions = [".sh", ".bash", ".zsh"] as const;
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Bash);
  }

  init(): void {
    // Parser inicializado y reutilizable entre archivos
  }

  extract(
    filePath: string,
    fileContent: string,
    context: ExtractorContext,
  ): ExtractedFile {
    const tree = this.parser.parse(fileContent);
    const root = context.root || projectRoot();
    const relPath = filePath.startsWith("/")
      ? relative(root, filePath).split(sep).join("/")
      : filePath.replace(/\\/g, "/");

    // Cabecera del archivo
    const { headerDoc, fileReqIds } = extractBashFileHeader(tree);

    // Símbolos
    const symbols: ExtractedSymbol[] = [];
    const children = tree.rootNode.children;

    for (let i = 0; i < children.length; i++) {
      const topNode = children[i];

      if (topNode.type === "function_definition") {
        const name = topNode.childForFieldName("name")?.text ?? "<anónimo>";
        const leadingComments = extractLeadingComments(topNode, children, i);
        const bodyNode = topNode.childForFieldName("body");
        const docReqIds = extractRequirementIds(`${leadingComments}\n${name}`);
        const bodyReqIds = bodyNode
          ? extractRequirementIds(bodyNode.text).filter((id) => !docReqIds.includes(id))
          : [];

        symbols.push({
          name,
          kind: "function",
          signature: `${name}()`,
          doc: leadingComments || `Función Shell: ${name}`,
          reqIds: docReqIds,
          bodyReqIds,
          line: topNode.startPosition.row + 1,
        });
      } else if (topNode.type === "declaration_command") {
        for (const sub of topNode.namedChildren) {
          if (sub.type === "variable_assignment") {
            const name = sub.childForFieldName("name")?.text;
            if (name) {
              const leadingComments = extractLeadingComments(topNode, children, i);
              const docReqIds = extractRequirementIds(`${leadingComments}\n${name}`);
              symbols.push({
                name,
                kind: "variable",
                signature: topNode.text.split("\n")[0].trim(),
                doc: leadingComments || `Variable de entorno/configuración: ${name}`,
                reqIds: docReqIds,
                bodyReqIds: [],
                line: topNode.startPosition.row + 1,
              });
            }
          }
        }
      } else if (topNode.type === "variable_assignment") {
        const name = topNode.childForFieldName("name")?.text;
        if (name) {
          const leadingComments = extractLeadingComments(topNode, children, i);
          const docReqIds = extractRequirementIds(`${leadingComments}\n${name}`);
          symbols.push({
            name,
            kind: "variable",
            signature: topNode.text.split("\n")[0].trim(),
            doc: leadingComments || `Variable global: ${name}`,
            reqIds: docReqIds,
            bodyReqIds: [],
            line: topNode.startPosition.row + 1,
          });
        }
      }
    }

    // Deduplicar símbolos por nombre preservando el primero
    const seen = new Set<string>();
    const uniqueSymbols = symbols.filter((s) => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });

    // Extracción de dependencias vía `source` y `.`
    const parsedImports: ParsedBashImport[] = [];
    const commandNodes = tree.rootNode.descendantsOfType("command");

    for (const cmd of commandNodes) {
      const nameNode = cmd.childForFieldName("name");
      const cmdName = nameNode?.text?.trim();

      if (cmdName === "source" || cmdName === ".") {
        const args = cmd.namedChildren.filter((c) => c !== nameNode);
        if (args.length > 0) {
          parsedImports.push({ rawTarget: args[0].text });
        }
      }
    }

    const importTargets = resolveBashImports(
      relPath,
      parsedImports,
      context.knownPaths,
      context.codeDirs,
    );

    return {
      relPath,
      headerComment: headerDoc,
      fileReqIds,
      symbols: uniqueSymbols,
      importTargets,
    };
  }
}
