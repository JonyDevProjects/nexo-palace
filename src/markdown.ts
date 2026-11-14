/**
 * Nexo-Palace Engine — parser de Markdown.
 *
 * No se usa una librería externa: el corpus de `docs/` tiene características
 * muy concretas (metadatos en negrita, sin YAML frontmatter en la mayoría de
 * archivos, IDs de épica `EPC-xx` y historias `US-xxx`) que un parser
 * genérico no cubre igual.
 */

import { getConfig } from "./config.ts";

/** Metadatos extraídos de un documento. */
export interface DocMeta {
  /** Identificador del documento (del frontmatter o derivado del título). */
  id?: string;
  /** Estado editorial: draft, in_progress, accepted, NEEDS_REVIEW... */
  status?: string;
  /** Fecha del documento, tal cual aparece en la fuente. */
  date?: string;
  /** Prioridad declarada (Alta/Media/Baja, P0/P1...). */
  priority?: string;
  /** Autor declarado. */
  author?: string;
  /** Versión declarada. */
  version?: string;
  /** Metadatos adicionales sin clasificar. */
  extra: Record<string, string>;
}

/** Un fragmento de documento con su jerarquía de títulos. */
export interface Section {
  /** Jerarquía completa, p. ej. `H2 Sprint 2 > H3 EPC-03`. */
  headerPath: string;
  /** Título de la sección (vacío para el preámbulo). */
  title: string;
  /** Nivel del encabezado (0 para el preámbulo). */
  level: number;
  /** Contenido textual de la sección. */
  content: string;
  /** IDs de requisitos (EPC-xx, US-xxx...) mencionados en la sección. */
  requirementIds: string[];
  /** IDs de requisitos definidos en las secciones ancestras (títulos padre). */
  ancestorReqIds: string[];
}

/** Documento parseado. */
export interface ParsedDoc {
  meta: DocMeta;
  /** Título principal del documento. */
  title: string;
  /** Secciones troceadas. */
  sections: Section[];
  /** Texto plano completo (sin frontmatter ni bloques de código). */
  plainText: string;
}

/**
 * Diccionario de equivalencias y alias de prefijos de trazabilidad (ES ↔ EN y variantes).
 * Mapea formas alternativas, sinónimos y variantes multilingües hacia su forma canónica.
 *
 * El destino se aplica si el proyecto declara ese prefijo canónico o la forma original.
 */
const ALIASES: Record<string, string> = {
  // Requisitos funcionales y no funcionales
  FR: "RF",
  FUNC: "RF",
  NFR: "RNF",
  NONFUNC: "RNF",

  // Historias de usuario y épicas
  HU: "US",
  HDU: "US",
  STORY: "US",
  HISTORY: "US",
  EPIC: "EPC",
  EP: "EPC",

  // Casos de uso
  UC: "CU",

  // Tareas y bugs
  TSK: "TASK",
  TAR: "TASK",
  FIX: "BUG",
  DEF: "BUG",

  // Pruebas y criterios de aceptación
  TC: "CP",
  TEST: "CP",
  AC: "CA",
};

/**
 * Expresiones regulares de IDs de trazabilidad.
 *
 * Los prefijos son configurables por proyecto (`requirementPrefixes` en
 * `nexo-palace.config.json`): `EPC-01` (épicas), `US-101` (historias),
 * `ADR-003` (decisiones de arquitectura) son los valores por defecto.
 *
 * También se admite la variante `EPIC 01` en encabezados, que se normaliza a
 * `EPC-01`.
 */
function requirementRegex(): RegExp {
  const prefixes = getConfig().requirementPrefixes;
  const escaped = prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Los alias solo se reconocen si su forma canónica está declarada.
  const aliasPatterns = Object.entries(ALIASES)
    .filter(([, canonical]) => prefixes.includes(canonical))
    .map(([alias]) => `\\b${alias}[\\s-]\\d{1,3}\\b`);
  const extra = aliasPatterns.length > 0 ? `|${aliasPatterns.join("|")}` : "";
  return new RegExp(`\\b(?:${escaped.join("|")})-[A-Z0-9]+\\b${extra}`, "gi");
}

/**
 * Normaliza un identificador de trazabilidad a su forma canónica.
 *
 * Los alias de prefijo (`EPIC` → `EPC`) solo se aplican si el prefijo destino
 * está declarado por el proyecto, para no inventar identificadores que su
 * convención no reconoce.
 */
export function normalizeRequirementId(raw: string): string {
  const upper = raw.trim().toUpperCase().replace(/\s+/g, "-");
  const prefixes = getConfig().requirementPrefixes;

  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (!prefixes.includes(canonical)) continue;
    const match = new RegExp(`^${alias}-(\\d{1,3})$`).exec(upper);
    if (match) return `${canonical}-${match[1].padStart(2, "0")}`;
  }

  return upper;
}

/** Normaliza una clave de metadato a snake_case en minúsculas. */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Clasifica una clave conocida para arrancar el mapa de metadatos. */
function assignKnown(key: string, value: string, meta: DocMeta): boolean {
  switch (key) {
    case "id":
    case "doc_id":
    case "codigo":
    case "code":
      meta.id = value;
      return true;
    case "status":
    case "estado":
    case "state":
      meta.status = value;
      return true;
    case "date":
    case "fecha":
    case "created":
    case "updated":
    case "reviewed":
      meta.date = value;
      return true;
    case "priority":
    case "prioridad":
      meta.priority = value;
      return true;
    case "author":
    case "autor":
    case "reviewed_by":
    case "owner":
      meta.author = value;
      return true;
    case "version":
    case "versio":
      meta.version = value;
      return true;
    default:
      return false;
  }
}

/**
 * Extrae un par clave/valor de una línea de metadatos en negrita.
 * Acepta `**Date:** 2026-01-20` y `**Date**: 2026-01-20`.
 */
function parseBoldMetaLine(line: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const bold = /\*\*([^*:]+):?\*\*\s*:?\s*(.*)/g;
  let m: RegExpExecArray | null;
  while ((m = bold.exec(line)) !== null) {
    const key = normalizeKey(m[1]);
    const value = m[2].trim();
    if (key && value) out.push([key, value]);
  }
  return out;
}

/**
 * Extrae pares clave/valor de una línea con pares separados por `|`.
 * Cubre el estilo `*Autor: X | Producto: Y | Fecha: Z*`.
 */
function parsePipeMetaLine(line: string): Array<[string, string]> {
  const trimmed = line.trim().replace(/^\*+/, "").replace(/\*+$/, "");
  if (!trimmed.includes("|") || !trimmed.includes(":")) return [];
  const parts = trimmed.split("|");
  if (parts.length < 2) return [];
  const out: Array<[string, string]> = [];
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = normalizeKey(part.slice(0, idx));
    const value = part.slice(idx + 1).trim();
    if (key && value) out.push([key, value]);
  }
  return out;
}

/**
 * Parsea un bloque YAML frontmatter con un subconjunto simple
 * (escalar, listas con `-`, comillas simples y dobles).
 */
function parseYamlFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = block.split("\n");
  let currentKey: string | null = null;
  let listBuffer: string[] = [];

  const flush = (): void => {
    if (currentKey && listBuffer.length > 0) {
      out[currentKey] = listBuffer.join("; ");
      listBuffer = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      listBuffer.push(listItem[1].trim().replace(/^['"]|['"]$/g, ""));
      continue;
    }

    const kv = /^([A-Za-z0-9_\-.]+)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      flush();
      currentKey = normalizeKey(kv[1]);
      const value = kv[2].trim().replace(/^['"]|['"]$/g, "");
      if (value) out[currentKey] = value;
    }
  }
  flush();
  return out;
}

/**
 * Detecta y extrae el frontmatter YAML si existe.
 * Devuelve `null` cuando el documento no lo tiene.
 */
export function extractFrontmatter(raw: string): { body: string; data: Record<string, string> | null } {
  if (!raw.startsWith("---")) return { body: raw, data: null };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { body: raw, data: null };
  return { body: raw.slice(match[0].length), data: parseYamlFrontmatter(match[1]) };
}

/**
 * Elimina los bloques de código delimitados (```) del contenido antes de
 * trocear. El código en línea (`así`) NO se elimina: sus identificadores
 * (`audit_report.md`, `MenuEditor`, `EPC-02`) son precisamente las señales
 * que hacen recuperable un fragmento.
 */
export function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ");
}

/** Extrae los IDs de requisito presentes en un texto. */
export function extractRequirementIds(text: string): string[] {
  const found = text.match(requirementRegex());
  if (!found) return [];
  return Array.from(new Set(found.map((s) => normalizeRequirementId(s))));
}

/** Divide un texto largo en trozos por párrafos, sin partir bloques. */
function splitLong(text: string, target: number): string[] {
  if (text.length <= target) return [text];
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const out: string[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    if (buffer.length + para.length + 2 > target && buffer.length > 0) {
      out.push(buffer.trim());
      buffer = "";
    }
    if (para.length > target) {
      // Párrafo muy largo: se corta por líneas.
      let rest = para;
      while (rest.length > target) {
        let cut = rest.lastIndexOf("\n", target);
        if (cut <= 0) cut = rest.lastIndexOf(" ", target);
        if (cut <= 0) cut = target;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) buffer = rest;
      continue;
    }
    buffer = buffer ? `${buffer}\n\n${para}` : para;
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out.filter((s) => s.length > 0);
}

/**
 * Parsea un documento Markdown completo en secciones indexables.
 */
export function parseMarkdown(raw: string, opts?: { stripCode?: boolean }): ParsedDoc {
  const stripCode = opts?.stripCode ?? true;
  const { body, data: frontmatter } = extractFrontmatter(raw);

  const meta: DocMeta = { extra: {} };
  if (frontmatter) {
    for (const [key, value] of Object.entries(frontmatter)) {
      if (!assignKnown(key, value, meta)) meta.extra[key] = value;
    }
  }

  const lines = body.split(/\r?\n/);

  // Título principal: primer H1.
  let title = "";
  const titleIdx = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (titleIdx >= 0) {
    title = lines[titleIdx].replace(/^#\s+/, "").trim();
  }

  // Metadatos heurísticos en las primeras líneas no vacías.
  const headScan = lines.slice(0, 40).join("\n").split("\n");
  for (const line of headScan) {
    if (!line.trim()) continue;
    const pairs = [
      ...parseBoldMetaLine(line),
      ...parsePipeMetaLine(line),
    ];
    for (const [key, value] of pairs) {
      if (!assignKnown(key, value, meta) && !(key in meta.extra)) {
        meta.extra[key] = value;
      }
    }
  }

  if (!meta.id) {
    // ID derivado: prefijo del nombre de archivo + slug del título.
    const reqIds = extractRequirementIds(`${title}\n${headScan.join("\n")}`);
    meta.id = reqIds[0] ?? undefined;
  }

  // ---- Troceado por encabezados -------------------------------------------
  interface RawSection {
    level: number;
    title: string;
    body: string;
  }

  const rawSections: RawSection[] = [];
  let current: RawSection = { level: 0, title: "", body: "" };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      if (current.title || current.body.trim()) rawSections.push(current);
      current = { level: heading[1].length, title: heading[2].trim(), body: "" };
      continue;
    }
    current.body += `${line}\n`;
  }
  if (current.title || current.body.trim()) rawSections.push(current);

  // Reconstrucción de la jerarquía de títulos.
  const hierarchy: Array<{ level: number; title: string; reqIds: string[] }> = [];
  const sections: Section[] = [];

  for (const raw of rawSections) {
    if (!raw.title && !raw.body.trim()) continue;
    while (hierarchy.length > 0 && hierarchy[hierarchy.length - 1].level >= raw.level) {
      hierarchy.pop();
    }
    if (raw.title) {
      hierarchy.push({
        level: raw.level,
        title: raw.title,
        reqIds: extractRequirementIds(raw.title),
      });
    }

    const headerPath = hierarchy.map((h) => `H${h.level} ${h.title}`).join(" > ");
    const body = stripCode ? stripCodeBlocks(raw.body) : raw.body;
    const content = raw.title ? `## ${raw.title}\n\n${body.trim()}`.trim() : body.trim();
    if (!content) continue;

    const pieces = splitLong(content, 4000);
    for (const piece of pieces) {
      sections.push({
        headerPath,
        title: raw.title,
        level: raw.level,
        content: piece,
        requirementIds: extractRequirementIds(`${headerPath}\n${piece}`),
        ancestorReqIds: hierarchy
          .slice(0, -1)
          .flatMap((h) => h.reqIds),
      });
    }
  }

  const plainText = sections.map((s) => s.content).join("\n\n");

  return { meta, title, sections, plainText };
}

/**
 * Extrae las líneas de estado directas que aparecen al inicio del documento
 * (el "estado" editorial que el indexador usa para el grafo).
 */
export function inferStatus(meta: DocMeta, raw: string): string {
  if (meta.status) return meta.status;

  const head = raw.slice(0, 4000);
  const patterns: Array<[RegExp, string]> = [
    [/\bNEEDS_REVIEW\b/i, "NEEDS_REVIEW"],
    [/\bON HOLD\b/i, "on_hold"],
    [/\bAPROBAD[OA]\b/i, "accepted"],
    [/\bAPROBADO\b/i, "accepted"],
    [/\bCOMPLETAD[OA]\b/i, "done"],
    [/\bEN CURSO\b/i, "in_progress"],
    [/\bBORRADOR\b/i, "draft"],
    [/\bDRAFT\b/i, "draft"],
    [/\bFINALIZAD[OA]\b/i, "done"],
  ];
  for (const [re, status] of patterns) {
    if (re.test(head)) return status;
  }
  return "draft";
}

/** Normaliza una expresión de estado escrita en prosa a un valor canónico. */
export function normalizeStatusText(text: string): string | null {
  const value = text.toUpperCase();
  const rules: Array<[RegExp, string]> = [
    [/\b(COMPLETAD[OA]|MERGEAD[OA]|FINALIZAD[OA]|DONE|ENTREGAD[OA])\b/, "done"],
    [/\b(EN ESPERA|ON HOLD|PAUSAD[OA]|EN ESPERA DE)\b/, "on_hold"],
    [/\b(EN CURSO|IN PROGRESS|EN DESARROLLO)\b/, "in_progress"],
    [/\b(PLANNED|PLANIFICAD[OA]|PENDIENTE)\b/, "planned"],
    [/\b(APROBAD[OA]|ACCEPTAD[OA]|FINALIZAD[OA])\b/, "accepted"],
    [/\b(ACTIV[OA]|INICIAD[OA])\b/, "active"],
  ];
  for (const [re, status] of rules) {
    if (re.test(value)) return status;
  }
  return null;
}

/**
 * Extrae el estado de cada requisito a partir de las tablas de estado.
 *
 * Muchos documentos de especificación resumen el estado de cada épica en una
 * tabla con una columna explícita ("Estado Operativo"). Es la fuente más
 * precisa: el mismo requisito puede estar activo en una tabla y mencionado
 * como "en espera" en otro punto del texto.
 */
export function parseStatusTables(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = text.split(/\r?\n/);

  let header: string[] | null = null;
  let statusCol = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      header = null;
      statusCol = -1;
      continue;
    }

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

    // Separador `|---|---|`: no aporta información.
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;

    if (!header) {
      header = cells;
      statusCol = cells.findIndex((c) => /estado|status/i.test(c));
      continue;
    }

    // Fila de datos: se busca la celda con el ID del requisito.
    const rowRegex = requirementRegex();
    const idCellIndex = cells.findIndex((c) => rowRegex.test(c));
    if (idCellIndex === -1) continue;

    const ids = cells[idCellIndex].match(requirementRegex());
    if (!ids || ids.length === 0) continue;

    let status: string | null = null;
    if (statusCol >= 0 && statusCol < cells.length) {
      status = normalizeStatusText(cells[statusCol]);
    }
    if (!status) {
      // Sin columna de estado explícita: se busca en el resto de la fila.
      for (const cell of cells) {
        status = normalizeStatusText(cell);
        if (status) break;
      }
    }
    if (!status) continue;

    for (const id of ids) {
      result.set(id.toUpperCase(), status);
    }
  }

  return result;
}
