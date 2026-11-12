/**
 * Nexo-Palace Engine — memoria decisional (Fase 3).
 *
 * Una decisión tomada durante el trabajo se guarda en dos sitios:
 *   * en la tabla `episodes` y en el grafo (nodo de tipo `decision`), para que
 *     `memory_trace` la relacione con los archivos que concernée;
 *   * en el fichero de decisiones que declara el proyecto
 *     (`decisionsFile` en `nexo-palace.config.json`), dentro del directorio de
 *     taste que el indexador ya recorre, de modo que la decisión queda también
 *     en el repositorio y es visible para quien lea las convenciones.
 *
 * El texto de la decisión se indexa con embeddings para que `memory_query`
 * la recupere por significado y no solo por coincidencia literal.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfig, projectRoot } from "./config.ts";
import { type Db, insertVector, openDb, replaceChunks, upsertEdge, upsertNode } from "./db.ts";
import { type EmbeddingProvider, createEmbeddingProvider } from "./embedder.ts";

/** Entrada de una decisión. */
export interface DecisionInput {
  /** Situación que originó la decisión. */
  context: string;
  /** Decisión tomada y su motivo. */
  decision: string;
  /** Etiquetas para la recuperación posterior. */
  tags?: string[];
  /** Archivos o requisitos relacionados. */
  relatedFiles?: string[];
}

/** Decisión registrada. */
export interface RecordedDecision {
  id: string;
  createdAt: string;
  context: string;
  decision: string;
  tags: string[];
  relatedFiles: string[];
  /** Ruta del fichero de taste donde se dejó constancia. */
  tasteFile: string;
}

/**
 * Fichero de taste donde se acumulan las decisiones.
 * Lo declara el proyecto en `nexo-palace.config.json`.
 */
function tasteDecisionsFile(): string {
  return join(projectRoot(), getConfig().decisionsFile);
}

/**
 * Registra una decisión: la persiste en la base, la enlaza en el grafo con los
 * archivos relacionados y la escribe en el directorio de taste.
 */
export async function recordDecision(
  input: DecisionInput,
  db: Db = openDb(),
  provider?: EmbeddingProvider,
): Promise<RecordedDecision> {
  const createdAt = new Date().toISOString();
  const id = `decision:${createdAt.replace(/[:.]/g, "-")}`;
  const tags = input.tags ?? [];
  const relatedFiles = input.relatedFiles ?? [];

  db.prepare(
    `INSERT INTO episodes (id, created_at, context, decision, tags, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, createdAt, input.context, input.decision, tags.join(","), "egm-resolve");

  upsertNode(db, {
    id,
    type: "decision",
    path: getConfig().decisionsFile,
    name: input.decision.slice(0, 80),
    status: "accepted",
    title: input.decision.slice(0, 120),
    meta: { context: input.context, tags, relatedFiles },
    updatedAt: createdAt,
  });

  // Enlace con los archivos y requisitos relacionados.
  for (const related of relatedFiles) {
    const clean = related.replace(/^\.\//, "");
    const target =
      db.prepare("SELECT id FROM nodes WHERE path = ?").get(clean) as { id: string } | undefined;
    if (!target) continue;
    upsertEdge(db, {
      sourceId: id,
      targetId: target.id,
      relation: "references",
      confidence: 1,
      meta: { via: "decision" },
    });
  }

  // Fragmento indexable + vector.
  const content = [
    `## Decisión ${createdAt.slice(0, 10)} — ${tags.join(", ") || "general"}`,
    "",
    `**Contexto:** ${input.context}`,
    "",
    `**Decisión:** ${input.decision}`,
    relatedFiles.length > 0 ? `\n**Archivos relacionados:** ${relatedFiles.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const chunkId = `chunk:${id}`;
  replaceChunks(db, id, [
    {
      id: chunkId,
      nodeId: id,
      seq: 0,
      content,
      headerPath: "Decisión registrada",
    },
  ]);

  const embedder = provider ?? (await createEmbeddingProvider());
  const [vector] = await embedder.embed([content]);
  if (vector) insertVector(db, chunkId, vector);

  // Constancia en el repositorio.
  const tasteFile = writeTasteDecision(input, createdAt, id, tags, relatedFiles);

  return {
    id,
    createdAt,
    context: input.context,
    decision: input.decision,
    tags,
    relatedFiles,
    tasteFile,
  };
}

/** Escribe la decisión en `.commandcode/taste/decisions.md`. */
function writeTasteDecision(
  input: DecisionInput,
  createdAt: string,
  id: string,
  tags: string[],
  relatedFiles: string[],
): string {
  const relPath = getConfig().decisionsFile;
  try {
    mkdirSync(dirname(join(projectRoot(), relPath)), { recursive: true });
    const header = existsHeader() ? "" : HEADER;
    const block = [
      header,
      `### ${createdAt.slice(0, 10)} — ${tags.join(", ") || "general"}`,
      "",
      `* **Contexto:** ${input.context}`,
      `* **Decisión:** ${input.decision}`,
      relatedFiles.length > 0 ? `* **Archivos relacionados:** ${relatedFiles.join(", ")}` : "",
      `* **Episodio:** \`${id}\``,
      "",
    ]
      .filter((l) => l !== "")
      .join("\n");
    appendFileSync(tasteDecisionsFile(), `${block}\n`, "utf8");
    return relPath;
  } catch {
    // Si el sistema de archivos no permite escribir, la decisión sigue en la base.
    return "";
  }
}

/** Comprueba si el fichero de decisiones ya tiene cabecera. */
function existsHeader(): boolean {
  try {
    const content = readFileSync(tasteDecisionsFile(), "utf8");
    return content.includes("# Decisiones");
  } catch {
    return false;
  }
}

/** Cabecera del fichero de decisiones. */
const HEADER = `# Decisiones

> Registro de decisiones de arquitectura tomadas durante la ejecución de las skills EGM.
> Este fichero lo mantiene el Nexo-Palace Engine a través de \`memory_record_decision\`.

`;
