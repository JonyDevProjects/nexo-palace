/**
 * Nexo-Palace Engine — capa de acceso a SQLite.
 *
 * Centraliza la apertura de la base, la carga de las extensiones (FTS5 nativa
 * y `sqlite-vec`), el esquema y las operaciones de escritura usadas por el
 * indexador. Todo el resto del motor habla con la base a través de este módulo.
 */
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { dbPath } from "./config.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

let instance: Db | null = null;
let instancePath: string | null = null;

/** Resultado de una comprobación de coherencia del índice vectorial. */
export interface VecState {
  /** Dimensión con la que está construida la tabla vectorial. */
  dim: number | null;
  /** Proveedor registrado en `meta`. */
  provider: string | null;
  /**
   * `true` si el índice vectorial no sirve para el proveedor solicitado.
   *
   * No basta con comparar la dimensión: dos modelos distintos pueden tener la
   * misma dimensión (LiteRT `nomic-embed-text` y Gemini `embedding-001` usan
   * 768) y sus vectores no son comparables entre sí.
   */
  needsRebuild: boolean;
}

/**
 * Abre (o crea) la base de datos del motor.
 *
 * Dentro de un proceso se mantiene una sola conexión, pero **solo si es la
 * misma ruta**: abrir otra base (por ejemplo, las de la comparativa de
 * proveedores) cierra la anterior en lugar de devolverla por error.
 */
export function openDb(path: string = dbPath()): Db {
  if (instance && instancePath === path) return instance;

  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path) as Db;
  // Set restrictive permissions on the database file
  try { chmodSync(path, 0o600); } catch {}

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  // FTS5 viene compilado en better-sqlite3; sqlite-vec es una extensión nativa.
  sqliteVec.load(db);

  applySchema(db);
  instance = db;
  instancePath = path;
  return db;
}

/** Cierra la instancia compartida (usado por tests y por el cierre del CLI). */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }
}

/** Aplica el esquema base (idempotente). */
export function applySchema(db: Db): void {
  const schema = readFileSync(join(HERE, "schema.sql"), "utf8");
  db.exec(schema);
  applyMigrations(db);
}

/**
 * Migraciones incrementales para bases creadas por versiones anteriores.
 * `CREATE TABLE IF NOT EXISTS` no añade columnas nuevas, así que aquí se
 * declaran las que se hayan ido incorporando al esquema.
 */
function applyMigrations(db: Db): void {
  const columns = (
    db.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string }>
  ).map((c) => c.name);

  if (!columns.includes("content_hash")) {
    db.exec("ALTER TABLE chunks ADD COLUMN content_hash TEXT;");
  }
}

/** Lee un valor de la tabla `meta`. */
export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/** Escribe un valor en la tabla `meta`. */
export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

/**
 * Comprueba si la tabla vectorial es compatible con la dimensión del proveedor
 * de embeddings que se va a usar. Si no lo es, hay que reconstruirla: `vec0`
 * fija la dimensión en el momento de la creación.
 */
export function vecState(db: Db, targetDim: number, requestedProvider?: string): VecState {
  const provider = getMeta(db, "embedding_provider");
  const dimRaw = getMeta(db, "embedding_dim");
  const dim = dimRaw ? Number(dimRaw) : null;
  const requested = requestedProvider ?? provider;

  let tableExists = false;
  try {
    db.prepare("SELECT count(*) AS c FROM chunks_vec").get();
    tableExists = true;
  } catch {
    tableExists = false;
  }

  const providerMismatch = provider !== null && requested !== null && provider !== requested;
  const dimMismatch = dim === null || dim !== targetDim;

  return {
    dim,
    provider,
    needsRebuild: !tableExists || providerMismatch || dimMismatch,
  };
}

/**
 * (Re)construye la tabla vectorial con la dimensión indicada y vacía los
 * vectores anteriores. La tabla FTS5 y los fragmentos se conservan: solo se
 * pierde la capa vectorial, que se regenera al reindexar.
 *
 * `allowSwitch` evita que un cambio de proveedor happened por accidente: sin
 * él, un índice construido con Gemini no se replaces en silencio por vectores
 * léxicos de otra dimensión.
 */
export function rebuildVecTable(db: Db, dim: number, provider: string): void {
  db.exec("DROP TABLE IF EXISTS chunks_vec;");
  db.exec(
    `CREATE VIRTUAL TABLE chunks_vec USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[${dim}]);`,
  );
  setMeta(db, "embedding_dim", String(dim));
  setMeta(db, "embedding_provider", provider);
  db.exec("DELETE FROM meta WHERE key = 'indexed_at'");
}

/**
 * Garantiza que la tabla vectorial sea compatible con el proveedor.
 *
 * Si el índice ya tiene una capa vectorial de otro proveedor y no se autoriza
 * el cambio, lanza un error explicativo en lugar de destruir los embeddings.
 */
export function ensureVecTable(
  db: Db,
  dim: number,
  provider: string,
  options: { allowSwitch?: boolean } = {},
): void {
  const state = vecState(db, dim, provider);
  if (!state.needsRebuild) return;

  const currentProvider = state.provider;
  if (currentProvider && currentProvider !== provider && !options.allowSwitch) {
    throw new Error(
      `El índice está construido con '${currentProvider}' (dim ${state.dim}) y el proveedor ` +
        `disponible es '${provider}' (dim ${dim}). Cambiar de proveedor reconstruye la tabla ` +
        `vectorial y descarta los embeddings actuales: aunque la dimensión coincida, ` +
        `los vectores de modelos distintos no son comparables. ` +
        `Reindexa con el proveedor original, o indica el cambio de forma explícita ` +
        `(--provider ${provider}).`,
    );
  }

  rebuildVecTable(db, dim, provider);
}

// -----------------------------------------------------------------------------
// Operaciones de escritura
// -----------------------------------------------------------------------------

export interface NodeRecord {
  id: string;
  type: string;
  path?: string | null;
  name: string;
  status?: string | null;
  title?: string | null;
  meta?: Record<string, unknown> | null;
  updatedAt?: string | null;
}

/** Inserta o actualiza un nodo del grafo. */
export function upsertNode(db: Db, node: NodeRecord): void {
  db.prepare(
    `INSERT INTO nodes (id, type, path, name, status, title, meta, updated_at)
     VALUES (@id, @type, @path, @name, @status, @title, @meta, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       type = excluded.type,
       path = excluded.path,
       name = excluded.name,
       status = excluded.status,
       title = excluded.title,
       meta = excluded.meta,
       updated_at = excluded.updated_at`,
  ).run({
    id: node.id,
    type: node.type,
    path: node.path ?? null,
    name: node.name,
    status: node.status ?? null,
    title: node.title ?? null,
    meta: node.meta ? JSON.stringify(node.meta) : null,
    updatedAt: node.updatedAt ?? new Date().toISOString(),
  });
}

export interface EdgeRecord {
  sourceId: string;
  targetId: string;
  relation: string;
  confidence?: number;
  meta?: Record<string, unknown> | null;
}

/** Inserta una arista del grafo de trazabilidad. */
export function upsertEdge(db: Db, edge: EdgeRecord): void {
  // Diagnóstico explícito: una arista huérfana es un fallo de integridad que
  // conviene señalar con el detalle, no con un error genérico de FK.
  for (const [role, id] of [
    ["source_id", edge.sourceId],
    ["target_id", edge.targetId],
  ] as const) {
    const found = db.prepare("SELECT id FROM nodes WHERE id = ?").get(id);
    if (!found) {
      throw new Error(
        `No se puede crear la arista ${edge.sourceId} -[${edge.relation}]-> ${edge.targetId}: ` +
          `${role} '${id}' no existe en nodes.`,
      );
    }
  }

  db.prepare(
    `INSERT INTO edges (source_id, target_id, relation, confidence, meta)
     VALUES (@sourceId, @targetId, @relation, @confidence, @meta)
     ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
       confidence = excluded.confidence,
       meta = excluded.meta`,
  ).run({
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    relation: edge.relation,
    confidence: edge.confidence ?? 1,
    meta: edge.meta ? JSON.stringify(edge.meta) : null,
  });
}

export interface ChunkRecord {
  id: string;
  nodeId: string;
  seq: number;
  content: string;
  headerPath?: string | null;
  /** IDs de requisitos (EPC-01, US-101...) mencionados en el fragmento. */
  requirementIds?: string[];
  /** Hash del contenido: permite no re-embeber un fragmento sin cambios. */
  contentHash?: string;
}

/**
 * Sustituye todos los fragmentos de un nodo (y sus entradas FTS5).
 * Se usa en cada reindexación: evita duplicados y mantiene FTS5 coherente.
 *
 * Los vectores de los fragmentos cuyo contenido **no ha cambiado** se
 * conservan: así una reindexación solo paga los embeddings del texto nuevo,
 * lo que importa con las cuotas por minuto de los proveedores remotos.
 */
export function replaceChunks(db: Db, nodeId: string, chunks: ChunkRecord[]): void {
  const existing = db
    .prepare("SELECT id, content_hash FROM chunks WHERE node_id = ?")
    .all(nodeId) as Array<{ id: string; content_hash: string | null }>;

  const newHashes = new Map(chunks.map((c) => [c.id, c.contentHash ?? null]));
  const ids = existing.map((r) => r.id);

  const del = db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
  const delChunk = db.prepare("DELETE FROM chunks WHERE id = ?");
  const tx = db.transaction(() => {
    for (const id of ids) {
      del.run(id);
      delChunk.run(id);
    }
  });
  tx();

  const insertChunk = db.prepare(
    `INSERT INTO chunks (id, node_id, seq, content, header_path, token_est, req_ids, content_hash)
     VALUES (@id, @nodeId, @seq, @content, @headerPath, @tokenEst, @reqIds, @contentHash)`,
  );
  const insertFts = db.prepare(
    `INSERT INTO chunks_fts (content, node_id, header_path, chunk_id)
     VALUES (@content, @nodeId, @headerPath, @id)`,
  );

  const tx2 = db.transaction(() => {
    for (const chunk of chunks) {
      insertChunk.run({
        id: chunk.id,
        nodeId: chunk.nodeId,
        seq: chunk.seq,
        content: chunk.content,
        headerPath: chunk.headerPath ?? null,
        tokenEst: Math.ceil(chunk.content.length / 4),
        reqIds: chunk.requirementIds?.length ? chunk.requirementIds.join(",") : null,
        contentHash: chunk.contentHash ?? null,
      });
      insertFts.run({
        content: chunk.content,
        nodeId: chunk.nodeId,
        headerPath: chunk.headerPath ?? null,
        id: chunk.id,
      });
    }
  });
  tx2();

  // Se borra el vector solo de los fragmentos cuyo contenido cambió o que
  // ya no existen; el resto conserva su embedding.
  try {
    const delVec = db.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?");
    const tx3 = db.transaction(() => {
      for (const row of existing) {
        const newHash = newHashes.get(row.id);
        const unchanged = newHash !== undefined && newHash === row.content_hash;
        if (!unchanged) delVec.run(row.id);
      }
    });
    tx3();
  } catch {
    // La tabla vectorial puede no existir todavía: es un caso esperado.
  }
}

/**
 * Devuelve el hash de contenido de los fragmentos ya indexados que **no**
 * tienen vector. Sirve para no re-embeber lo que no ha cambiado.
 */
export function chunksMissingVector(db: Db, hashes: Map<string, string>): Set<string> {
  const missing = new Set<string>();
  if (hashes.size === 0) return missing;
  const rows = db
    .prepare("SELECT id, content_hash FROM chunks")
    .all() as Array<{ id: string; content_hash: string | null }>;
  const withVector = new Set(
    (db.prepare("SELECT chunk_id FROM chunks_vec").all() as Array<{ chunk_id: string }>).map(
      (r) => r.chunk_id,
    ),
  );
  for (const row of rows) {
    const expected = hashes.get(row.id);
    if (expected === undefined) continue;
    if (row.content_hash === expected && withVector.has(row.id)) continue;
    missing.add(row.id);
  }
  return missing;
}

/**
 * Inserta un vector para un fragmento.
 *
 * `sqlite-vec` no implementa `INSERT OR REPLACE` sobre su clave primaria, así
 * que se borra la fila previa antes de insertar.
 */
export function insertVector(db: Db, chunkId: string, embedding: Float32Array): void {
  db.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?").run(chunkId);
  db.prepare("INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)").run(
    chunkId,
    embedding,
  );
}

/** Elimina un nodo y todo lo que cuelga de él. */
export function deleteNode(db: Db, nodeId: string): void {
  const ids = (db.prepare("SELECT id FROM chunks WHERE node_id = ?").all(nodeId) as Array<{
    id: string;
  }>).map((r) => r.id);

  const tx = db.transaction(() => {
    const delFts = db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
    const delChunk = db.prepare("DELETE FROM chunks WHERE node_id = ?");
    const delVec = db.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?");
    for (const id of ids) {
      delFts.run(id);
      try {
        delVec.run(id);
      } catch {
        /* tabla vectorial ausente */
      }
    }
    delChunk.run(nodeId);
    db.prepare("DELETE FROM nodes WHERE id = ?").run(nodeId);
  });
  tx();
}

/**
 * Garantiza que exista el nodo de un requisito.
 *
 * El código puede citar un requisito (`EPC-07`) que ningún documento define
 * todavía. En ese caso se crea un nodo provisional, marcado como tal, en
 * lugar de descartar la arista o romper la integridad referencial.
 */
export function ensureRequirementNode(db: Db, reqId: string, sourcePath?: string | null): string {
  const id = `req:${reqId}`;
  const existing = db.prepare("SELECT id FROM nodes WHERE id = ?").get(id);
  if (existing) return id;

  upsertNode(db, {
    id,
    type: "requirement",
    path: sourcePath ?? null,
    name: reqId,
    status: "unlinked",
    title: reqId,
    meta: { provisional: true },
    updatedAt: new Date().toISOString(),
  });
  return id;
}

/**
 * Proveedor con el que se construyó el índice vectorial.
 * Devuelve `null` si el índice no tiene aún capa vectorial.
 */
export function indexProvider(db: Db): { id: string | null; dim: number | null } {
  const id = getMeta(db, "embedding_provider");
  const dimRaw = getMeta(db, "embedding_dim");
  return { id, dim: dimRaw ? Number(dimRaw) : null };
}

/** Resumen estadístico del índice. */
export function indexStats(db: Db): {
  nodes: number;
  edges: number;
  chunks: number;
  vectors: number;
  byType: Array<{ type: string; count: number }>;
  provider: string | null;
  dim: number | null;
  indexedAt: string | null;
} {
  const count = (sql: string): number =>
    (db.prepare(sql).get() as { c: number }).c ?? 0;

  let vectors = 0;
  try {
    vectors = count("SELECT count(*) AS c FROM chunks_vec");
  } catch {
    vectors = 0;
  }

  return {
    nodes: count("SELECT count(*) AS c FROM nodes"),
    edges: count("SELECT count(*) AS c FROM edges"),
    chunks: count("SELECT count(*) AS c FROM chunks"),
    vectors,
    byType: db
      .prepare("SELECT type, count(*) AS count FROM nodes GROUP BY type ORDER BY count DESC")
      .all() as Array<{ type: string; count: number }>,
    provider: getMeta(db, "embedding_provider"),
    dim: getMeta(db, "embedding_dim") ? Number(getMeta(db, "embedding_dim")) : null,
    indexedAt: getMeta(db, "indexed_at"),
  };
}
