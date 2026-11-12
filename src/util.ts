/**
 * Nexo-Palace Engine — utilidades de sistema de archivos.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { getConfig, projectRoot } from "./config.ts";

/** Devuelve la ruta relativa al proyecto, con separadores `/`. */
export function repoRelative(absPath: string): string {
  return relative(projectRoot(), absPath).split(sep).join("/");
}

/**
 * Recorre un directorio de forma recursiva y devuelve las rutas absolutas de
 * los archivos que cumplen el filtro.
 */
export function walkFiles(
  dir: string,
  filter: (file: string) => boolean,
  out: string[] = [],
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (getConfig().ignoreDirs.includes(entry)) continue;
      walkFiles(full, filter, out);
    } else if (stats.isFile() && filter(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Filtro de archivos Markdown. */
export function isMarkdown(file: string): boolean {
  return file.toLowerCase().endsWith(".md");
}

/** Normaliza un identificador de nodo: estable y seguro como clave primaria. */
export function nodeId(kind: string, key: string): string {
  return `${kind}:${key}`;
}

/**
 * Genera un hash determinista (djb2 en hexadecimal) de un texto.
 * Se usa para detectar cambios de contenido sin depender del sistema de archivos.
 */
export function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
