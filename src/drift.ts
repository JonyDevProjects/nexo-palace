/**
 * Nexo-Palace Engine — detección de deriva (Fase 3).
 *
 * Compara los archivos de código modificados (según Git) con los requisitos
 * del grafo que esos archivos implementan. Cuando un requisito tiene código
 * asociado que ha cambiado, el requisito se marca como `NEEDS_REVIEW` y se
 * registra el evento de deriva con su motivo.
 *
 * La deriva no se inventa: solo se marcan requisitos que ya están enlazados a
 * código por el grafo (comentarios `@implements`, citas en documentación o
 * imports reales).
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { projectRoot } from "./config.ts";
import { type Db, openDb, upsertNode } from "./db.ts";

/** Un evento de deriva detectado. */
export interface DriftEvent {
  requirement: string;
  docPath: string | null;
  reason: string;
  changedFiles: string[];
  status: "open";
}

/** Opciones de la detección. */
export interface DriftOptions {
  /** Referencia contra la que comparar (por defecto, `HEAD`). */
  baseRef?: string;
  /** Archivos concretos a considerar (por defecto, los que devuelve Git). */
  paths?: string[];
  /** Marca los requisitos afectados (por defecto `true`). */
  mark?: boolean;
}

/** Resultado de una detección. */
export interface DriftResult {
  /** Archivos de código modificados detectados. */
  changedFiles: string[];
  /** Eventos de deriva encontrados. */
  events: DriftEvent[];
  /** Requisitos marcados como `NEEDS_REVIEW`. */
  marked: string[];
  /** Error si Git no pudo ejecutarse. */
  error?: string;
}

/** Ejecuta Git y devuelve su salida. */
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: projectRoot(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Lista los archivos modificados en el árbol de trabajo y el índice. */
export function changedFiles(baseRef?: string): string[] {
  const files = new Set<string>();
  try {
    const uncommitted = git(["diff", "--name-only", "HEAD"]);
    for (const line of uncommitted.split("\n")) {
      if (line.trim()) files.add(line.trim());
    }
  } catch {
    // Sin HEAD (repositorio recién inicializado): se ignora.
  }

  if (baseRef) {
    try {
      const committed = git(["diff", "--name-only", `${baseRef}...HEAD`]);
      for (const line of committed.split("\n")) {
        if (line.trim()) files.add(line.trim());
      }
    } catch {
      // Referencia inexistente: se ignora.
    }
  }

  return Array.from(files).sort();
}

/**
 * Detecta la deriva entre el código modificado y los requisitos del grafo.
 */
export function detectDrift(
  options: DriftOptions = {},
  db: Db = openDb(),
): DriftResult {
  const modified = options.paths ?? changedFiles(options.baseRef);
  const codeFiles = modified.filter((p) => /\.(ts|tsx|js|jsx)$/.test(p));

  if (codeFiles.length === 0) {
    return { changedFiles: modified, events: [], marked: [] };
  }

  // Requisitos enlazados a cada archivo modificado.
  const requirementMap = new Map<string, { docPath: string | null; files: Set<string>; via: Set<string> }>();

  const rows = db
    .prepare(
      `SELECT e.source_id, e.target_id, e.relation, e.meta,
              s.path AS source_path, t.path AS target_path, t.name AS target_name
       FROM edges e
       JOIN nodes s ON s.id = e.source_id
       JOIN nodes t ON t.id = e.target_id
       WHERE t.type = 'requirement'
         AND e.relation IN ('implements', 'references')
         AND s.path IN (${codeFiles.map(() => "?").join(",")})`,
    )
    .all(...codeFiles) as Array<{
    source_id: string;
    target_id: string;
    relation: string;
    meta: string | null;
    source_path: string;
    target_path: string | null;
    target_name: string;
  }>;

  for (const row of rows) {
    const reqName = row.target_name;
    let via = "grafo";
    try {
      via = row.meta ? ((JSON.parse(row.meta).via as string) ?? "grafo") : "grafo";
    } catch {
      via = "grafo";
    }
    const entry = requirementMap.get(reqName) ?? {
      docPath: row.target_path,
      files: new Set<string>(),
      via: new Set<string>(),
    };
    entry.files.add(row.source_path);
    entry.via.add(via);
    requirementMap.set(reqName, entry);
  }

  const events: DriftEvent[] = [];
  const marked: string[] = [];

  for (const [requirement, info] of requirementMap) {
    const event: DriftEvent = {
      requirement,
      docPath: info.docPath,
      reason: `Código vinculado modificado: ${Array.from(info.files).join(", ")} (vínculo por ${Array.from(info.via).join(", ")})`,
      changedFiles: Array.from(info.files),
      status: "open",
    };
    events.push(event);

    db.prepare(
      `INSERT INTO drift_events (id, detected_at, requirement, doc_path, reason, commit_sha, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
    ).run(
      `drift:${Date.now()}:${requirement}`,
      new Date().toISOString(),
      requirement,
      info.docPath,
      event.reason,
      safeHeadSha(),
    );

    if (options.mark !== false) {
      const reqNode = db.prepare("SELECT id, type, path, name, title FROM nodes WHERE id = ?").get(
        `req:${requirement}`,
      ) as { id: string; type: string; path: string | null; name: string; title: string | null } | undefined;

      if (reqNode) {
        upsertNode(db, {
          id: reqNode.id,
          type: reqNode.type,
          path: reqNode.path,
          name: reqNode.name,
          status: "NEEDS_REVIEW",
          title: reqNode.title,
          updatedAt: new Date().toISOString(),
        });
        marked.push(requirement);
      }

      // El documento que define el requisito queda marcado también.
      if (info.docPath) {
        const docNode = db
          .prepare("SELECT id, type, path, name, title, status FROM nodes WHERE path = ? AND type IN ('doc','taste')")
          .get(info.docPath) as
          | { id: string; type: string; path: string | null; name: string; title: string | null; status: string | null }
          | undefined;
        if (docNode && docNode.status !== "NEEDS_REVIEW") {
          upsertNode(db, {
            id: docNode.id,
            type: docNode.type,
            path: docNode.path,
            name: docNode.name,
            status: "NEEDS_REVIEW",
            title: docNode.title,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  return { changedFiles: modified, events, marked };
}

/** SHA del commit actual (o `null` si no hay commits). */
export function safeHeadSha(): string | null {
  try {
    return git(["rev-parse", "HEAD"]).trim();
  } catch {
    return null;
  }
}
