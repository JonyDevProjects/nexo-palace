/**
 * Nexo-Palace Engine — Extractor de Python mediante tree-sitter.
 *
 * Analiza archivos .py para extraer:
 *   - Símbolos (funciones síncronas/asíncronas, clases y métodos decorados);
 *   - Documentación (docstrings PEP 257 y comentarios adyacentes #);
 *   - Identificadores de requisitos (@implements RF-XX);
 *   - Dependencias de imports relativos y absolutos dentro del repositorio.
 */
import { dirname, join, normalize } from "node:path";
import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import { extractRequirementIds } from "../markdown.ts";
import { repoRelative } from "../util.ts";
import type {
  ExtractedFile,
  ExtractedSymbol,
  ExtractorContext,
  LanguageExtractor,
} from "./types.ts";

/** Limpia delimitadores de docstring en Python (""" o ''' o comillas simples). */
function cleanDocstring(text: string): string {
  return text
    .replace(/^(?:[ru]?["']{3}|[ru]?["'])/i, "")
    .replace(/(?:["']{3}|["'])$/, "")
    .trim();
}

/** Extrae el docstring inicial del cuerpo de un bloque AST. */
function extractNodeDocstring(bodyNode: Parser.SyntaxNode | null): string {
  if (!bodyNode) return "";
  const first = bodyNode.firstNamedChild;
  if (first && first.type === "expression_statement") {
    const strNode = first.namedChildren.find((c) => c.type === "string");
    if (strNode) return cleanDocstring(strNode.text);
  }
  return "";
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
      comments.unshift(prev.text.replace(/^#\s?/, ""));
      expectedRow = prev.startPosition.row - 1;
      prevIdx--;
    } else {
      break;
    }
  }
  return comments.join("\n").trim();
}

/** Extrae el comentario o docstring de cabecera a nivel de archivo. */
function extractPythonFileHeader(tree: Parser.Tree): { headerDoc: string; fileReqIds: string[] } {
  const comments: string[] = [];
  let docstring = "";

  for (const child of tree.rootNode.children) {
    if (child.type === "comment") {
      comments.push(child.text.replace(/^#\s?/, ""));
    } else if (child.type === "expression_statement" && !docstring) {
      const str = child.namedChildren.find((c) => c.type === "string");
      if (str) {
        docstring = cleanDocstring(str.text);
      }
      break;
    } else {
      break;
    }
  }

  const combined = [...comments, docstring].filter(Boolean).join("\n").trim();
  return {
    headerDoc: combined,
    fileReqIds: extractRequirementIds(combined),
  };
}

/** Construye la firma de una función en Python. */
function formatFunctionSignature(fnNode: Parser.SyntaxNode): string {
  const name = fnNode.childForFieldName("name")?.text ?? "<anónimo>";
  const params = fnNode.childForFieldName("parameters")?.text ?? "()";
  const retNode = fnNode.childForFieldName("return_type");
  const ret = retNode ? ` -> ${retNode.text}` : "";
  const isAsync = fnNode.text.startsWith("async ");
  return `${isAsync ? "async def" : "def"} ${name}${params}${ret}`;
}

/** Construye la firma de una clase en Python. */
function formatClassSignature(clsNode: Parser.SyntaxNode): string {
  const name = clsNode.childForFieldName("name")?.text ?? "<anónimo>";
  const superclasses = clsNode.childForFieldName("superclasses")?.text;
  return superclasses ? `class ${name}${superclasses}` : `class ${name}`;
}

interface ParsedImport {
  moduleName: string;
  names: string[];
}

/**
 * Resuelve una lista de imports en Python contra las rutas conocidas del proyecto.
 */
function resolvePythonImports(
  sourceRelPath: string,
  imports: ParsedImport[],
  knownPaths: Set<string>,
  codeDirs: string[] = ["src", "lib", "app", "tests", "test"],
): string[] {
  const resolved = new Set<string>();

  const addIfKnown = (candidate: string): void => {
    const norm = normalize(candidate).replace(/^(\.\/|\/)/, "");
    if (knownPaths.has(norm)) {
      resolved.add(norm);
    }
  };

  for (const item of imports) {
    const { moduleName, names } = item;
    if (!moduleName && names.length === 0) continue;

    if (moduleName.startsWith(".")) {
      // Import relativo (p. ej. `from . import helper`, `from ..lib.util import x`)
      const match = moduleName.match(/^(\.+)(.*)$/);
      if (match) {
        const dots = match[1].length;
        const rest = match[2];
        let dir = dirname(sourceRelPath);
        for (let i = 1; i < dots; i++) {
          dir = dirname(dir);
        }
        if (rest) {
          const sub = rest.replace(/\./g, "/");
          addIfKnown(join(dir, `${sub}.py`));
          addIfKnown(join(dir, sub, "__init__.py"));
          for (const name of names) {
            addIfKnown(join(dir, sub, `${name}.py`));
            addIfKnown(join(dir, sub, name, "__init__.py"));
          }
        } else {
          for (const name of names) {
            addIfKnown(join(dir, `${name}.py`));
            addIfKnown(join(dir, name, "__init__.py"));
          }
        }
      }
    } else {
      // Import absoluto del proyecto (p. ej. `from app.services import calc` o `import calc`)
      const sub = moduleName.replace(/\./g, "/");
      addIfKnown(`${sub}.py`);
      addIfKnown(join(sub, "__init__.py"));
      for (const name of names) {
        addIfKnown(join(sub, `${name}.py`));
        addIfKnown(join(sub, name, "__init__.py"));
      }

      // Relativo al directorio actual
      const dir = dirname(sourceRelPath);
      addIfKnown(join(dir, `${sub}.py`));
      addIfKnown(join(dir, sub, "__init__.py"));

      // Dentro de cualquiera de los directorios de código declarados
      for (const codeDir of codeDirs) {
        addIfKnown(join(codeDir, `${sub}.py`));
        addIfKnown(join(codeDir, sub, "__init__.py"));
        for (const name of names) {
          addIfKnown(join(codeDir, sub, `${name}.py`));
          addIfKnown(join(codeDir, sub, name, "__init__.py"));
        }
      }
    }
  }

  return Array.from(resolved);
}

/**
 * Extractor políglota para Python basado en tree-sitter.
 */
export class PythonExtractor implements LanguageExtractor {
  readonly name = "python";
  readonly extensions = [".py"] as const;
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Python);
  }

  init(): void {
    // Parser ya inicializado y reutilizable
  }

  extract(
    filePath: string,
    fileContent: string,
    context: ExtractorContext,
  ): ExtractedFile {
    const tree = this.parser.parse(fileContent);
    const relPath = repoRelative(filePath);

    // Cabecera del archivo
    const { headerDoc, fileReqIds } = extractPythonFileHeader(tree);

    // Símbolos
    const symbols: ExtractedSymbol[] = [];
    const children = tree.rootNode.children;

    for (let i = 0; i < children.length; i++) {
      const topNode = children[i];
      let targetNode = topNode;

      if (topNode.type === "decorated_definition") {
        const inner = topNode.namedChildren.find(
          (c) => c.type === "function_definition" || c.type === "class_definition",
        );
        if (inner) targetNode = inner;
      }

      if (targetNode.type === "function_definition") {
        const name = targetNode.childForFieldName("name")?.text ?? "<anónimo>";
        const leadingComments = extractLeadingComments(topNode, children, i);
        const docstring = extractNodeDocstring(targetNode.childForFieldName("body"));
        const doc = [leadingComments, docstring].filter(Boolean).join("\n").trim();
        const docReqIds = extractRequirementIds(`${doc}\n${name}`);
        const bodyReqIds = extractRequirementIds(targetNode.text).filter(
          (id) => !docReqIds.includes(id),
        );

        symbols.push({
          name,
          kind: "function",
          signature: formatFunctionSignature(targetNode),
          doc,
          reqIds: docReqIds,
          bodyReqIds,
          line: topNode.startPosition.row + 1,
        });
      } else if (targetNode.type === "class_definition") {
        const name = targetNode.childForFieldName("name")?.text ?? "<anónimo>";
        const leadingComments = extractLeadingComments(topNode, children, i);
        const docstring = extractNodeDocstring(targetNode.childForFieldName("body"));
        const doc = [leadingComments, docstring].filter(Boolean).join("\n").trim();
        const docReqIds = extractRequirementIds(`${doc}\n${name}`);
        const bodyReqIds = extractRequirementIds(targetNode.text).filter(
          (id) => !docReqIds.includes(id),
        );

        symbols.push({
          name,
          kind: "class",
          signature: formatClassSignature(targetNode),
          doc,
          reqIds: docReqIds,
          bodyReqIds,
          line: topNode.startPosition.row + 1,
        });
      }
    }

    // Deduplicar símbolos por nombre
    const seen = new Set<string>();
    const uniqueSymbols = symbols.filter((s) => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });

    // Extracción de imports
    const parsedImports: ParsedImport[] = [];
    const importNodes = tree.rootNode.descendantsOfType([
      "import_statement",
      "import_from_statement",
    ]);

    for (const node of importNodes) {
      if (node.type === "import_statement") {
        for (const child of node.namedChildren) {
          if (child.type === "dotted_name") {
            parsedImports.push({ moduleName: child.text, names: [] });
          } else if (child.type === "aliased_import") {
            const original = child.childForFieldName("name")?.text;
            if (original) parsedImports.push({ moduleName: original, names: [] });
          }
        }
      } else if (node.type === "import_from_statement") {
        const modNode = node.childForFieldName("module_name");
        const moduleName = modNode?.text ?? "";
        const names: string[] = [];
        for (const child of node.namedChildren) {
          if (child === modNode) continue;
          if (child.type === "dotted_name" || child.type === "identifier") {
            names.push(child.text);
          } else if (child.type === "aliased_import") {
            const original = child.childForFieldName("name")?.text;
            if (original) names.push(original);
          }
        }
        parsedImports.push({ moduleName, names });
      }
    }

    const importTargets = resolvePythonImports(
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
