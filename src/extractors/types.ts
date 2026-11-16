/**
 * Nexo-Palace Engine — Tipos y contratos del sistema de extractores políglotas.
 *
 * Desacopla la extracción AST de TypeScript (ts-morph) y futuros lenguajes
 * (Python, Go, Rust vía tree-sitter) del pipeline central de indexación.
 */

/** Un símbolo de código extraído. */
export interface ExtractedSymbol {
  name: string;
  kind: string;
  signature: string;
  doc: string;
  /** Requisitos citados en el comentario de documentación del símbolo. */
  reqIds: string[];
  /** Requisitos citados dentro del cuerpo del símbolo (JSX, comentarios de función). */
  bodyReqIds: string[];
  line: number;
}

/** Resumen de extracción de un archivo de código individual. */
export interface ExtractedFile {
  relPath: string;
  headerComment: string;
  fileReqIds: string[];
  symbols: ExtractedSymbol[];
  /** Rutas relativas al repositorio de módulos importados directamente. */
  importTargets: string[];
}

/** Contexto compartido proporcionado a cada extractor. */
export interface ExtractorContext {
  root: string;
  knownPaths: Set<string>;
  codeDirs?: string[];
}

/**
 * Interfaz común para extractores de código (TypeScript, Python, etc.).
 */
export interface LanguageExtractor {
  readonly name: string;
  readonly extensions: readonly string[];

  /** Inicialización por lote antes de extraer archivos. */
  init?(files: string[], context: ExtractorContext): void | Promise<void>;

  /** Extrae símbolos, requisitos e imports de un archivo. */
  extract(
    filePath: string,
    fileContent: string,
    context: ExtractorContext,
  ): Promise<ExtractedFile> | ExtractedFile;
}
