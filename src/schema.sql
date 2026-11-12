-- =============================================================================
-- Nexo-Palace Engine — esquema unificado (grafo + FTS5 + vectores)
-- =============================================================================
-- Un único archivo SQLite contiene:
--   * `nodes`  : entidades del proyecto (documentos, código, tests, taste)
--   * `edges`  : grafo de trazabilidad entre esas entidades
--   * `chunks` : fragmentos de texto recuperables
--   * `chunks_fts` : índice léxico BM25 (FTS5)
--   * `chunks_vec` : índice vectorial (sqlite-vec)
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Meta: parámetros del build del índice (dimensión y proveedor de embeddings).
-- Si cambian, el motor reindexa los vectores para no mezclar espacios.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- Nodos: la unicidad de cada entidad del proyecto.
--   type    : doc | code | test | taste | requirement | decision
--   path    : ruta relativa al repositorio (NULL para nodos virtuales)
--   name    : identificador legible (nombre de archivo, símbolo, ID de épica)
--   status  : estado editorial/técnico (draft, NEEDS_REVIEW, accepted, ...)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
  id        TEXT PRIMARY KEY,
  type      TEXT NOT NULL,
  path      TEXT,
  name      TEXT NOT NULL,
  status    TEXT,
  title     TEXT,
  meta      TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);

-- -----------------------------------------------------------------------------
-- Aristas: relaciones del grafo de trazabilidad.
--   relation : implements | tests | contains | governed_by | depends_on
--               | references | derived_from | deprecated_by
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edges (
  source_id  TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  relation   TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  meta       TEXT,
  PRIMARY KEY (source_id, target_id, relation),
  FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);

-- -----------------------------------------------------------------------------
-- Fragmentos de texto: la unidad que se indexa y se devuelve al agente.
--   header_path : jerarquía de títulos, p. ej. "H2 Sprint 2 > H3 EPC-03"
--   embedding   : id lógico del vector (vincula con chunks_vec)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chunks (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  content     TEXT NOT NULL,
  header_path TEXT,
  token_est   INTEGER,
  req_ids     TEXT,
  content_hash TEXT,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_node ON chunks(node_id);

-- -----------------------------------------------------------------------------
-- Búsqueda léxica exacta (BM25) para IDs de tickets, nombres de funciones y
-- variables. Se mantiene sincronizada por triggers con `chunks`.
-- -----------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  node_id UNINDEXED,
  header_path UNINDEXED,
  chunk_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- -----------------------------------------------------------------------------
-- Episodios: memoria decisional registrada por los agentes (Fase 3).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS episodes (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  context    TEXT NOT NULL,
  decision   TEXT NOT NULL,
  tags       TEXT,
  source     TEXT
);

CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at);

-- -----------------------------------------------------------------------------
-- Deriva: registro de requisitos marcados para revisión por cambios de código.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drift_events (
  id          TEXT PRIMARY KEY,
  detected_at TEXT NOT NULL,
  requirement TEXT NOT NULL,
  doc_path    TEXT,
  reason      TEXT,
  commit_sha  TEXT,
  status      TEXT DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_drift_requirement ON drift_events(requirement);
CREATE INDEX IF NOT EXISTS idx_drift_status ON drift_events(status);
