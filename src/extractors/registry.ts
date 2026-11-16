/**
 * Nexo-Palace Engine — Registro central de extractores de lenguaje.
 */
import { CssExtractor } from "./css-extractor.ts";
import { HtmlExtractor } from "./html-extractor.ts";
import { PythonExtractor } from "./python-extractor.ts";
import { SqlExtractor } from "./sql-extractor.ts";
import { TsExtractor } from "./ts-extractor.ts";
import type { LanguageExtractor } from "./types.ts";

export class ExtractorRegistry {
  private extractors: LanguageExtractor[] = [];
  private extMap: Map<string, LanguageExtractor> = new Map();

  /** Registra un nuevo extractor de lenguaje en el sistema. */
  register(extractor: LanguageExtractor): void {
    this.extractors.push(extractor);
    for (const ext of extractor.extensions) {
      this.extMap.set(ext.toLowerCase(), extractor);
    }
  }

  /** Devuelve el extractor adecuado para la ruta de archivo indicada. */
  getExtractorForPath(filePath: string): LanguageExtractor | undefined {
    const dotIdx = filePath.lastIndexOf(".");
    if (dotIdx === -1) return undefined;
    const ext = filePath.slice(dotIdx).toLowerCase();
    return this.extMap.get(ext);
  }

  /** Devuelve todas las extensiones soportadas por los extractores registrados. */
  getSupportedExtensions(): string[] {
    return Array.from(this.extMap.keys());
  }

  /** Devuelve la lista de extractores registrados. */
  getAllExtractors(): LanguageExtractor[] {
    return [...this.extractors];
  }
}

/**
 * Crea e inicializa el registro por defecto con TypeScript/JS, Python, HTML, CSS/SCSS/Less y SQL.
 */
export function createDefaultRegistry(): ExtractorRegistry {
  const registry = new ExtractorRegistry();
  registry.register(new TsExtractor());
  registry.register(new PythonExtractor());
  registry.register(new HtmlExtractor());
  registry.register(new CssExtractor());
  registry.register(new SqlExtractor());
  return registry;
}
