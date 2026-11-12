/**
 * Nexo-Palace Engine — búsqueda híbrida (léxica + semántica).
 *
 * Combina tres señales y las fusiona con Reciprocal Rank Fusion:
 *   1. FTS5/BM25 sobre el texto de los fragmentos.
 *   2. Coincidencia literal de identificadores (`EPC-02`, `MenuEditor`),
 *      que sobrevive a la tokenización de FTS5 y a los acentos.
 *   3. Vecindad vectorial (KNN de `sqlite-vec`).
 */
import { type Db, openDb } from "./db.ts";
import { tokenize } from "./embedder.ts";
import { type EmbeddingProvider } from "./embedder.ts";

/** Opciones de una consulta híbrida. */
export interface QueryOptions {
  /** Filtro de alcance: tipo de nodo (`doc`, `code`, `test`, `taste`, `requirement`) o `all`. */
  scope?: string;
  /** Máximo de resultados a devolver. */
  limit?: number;
  /** Prefijo de ruta para acotar (p. ej. `docs/`). */
  pathPrefix?: string;
  /** Devuelve el contenido completo de los fragmentos (por defecto, `true`). */
  includeContent?: boolean;
  /**
   * Modo de búsqueda.
   * - `hybrid` (por defecto): BM25 + coincidencia literal + vectorial.
   * - `vector`: solo la señal vectorial. Sirve para comparar modelos de
   *   embedding sin que la recuperación léxica oculte las diferencias.
   * - `lexical`: solo BM25 y coincidencia literal.
   */
  mode?: "hybrid" | "vector" | "lexical";
}

/** Un resultado de búsqueda. */
export interface SearchResult {
  chunkId: string;
  nodeId: string;
  nodeType: string;
  path: string | null;
  name: string;
  title: string | null;
  status: string | null;
  headerPath: string | null;
  content: string;
  /** Puntuación fusionada (RRF). */
  score: number;
  /** Rango en la lista léxica (1 = mejor). */
  lexicalRank: number | null;
  /** Rango en la lista vectorial (1 = mejor). */
  vectorRank: number | null;
  /** Puntuación BM25 (negativa: más negativo = mejor). */
  bm25: number | null;
  /** Distancia coseno de la búsqueda vectorial. */
  distance: number | null;
  /** Coincidencia literal de un identificador de la consulta. */
  literal: boolean;
  /** Fragmentos de requisitos asociados. */
  requirementIds: string[];
}

/** Evita repetir el aviso de vector no disponible en cada consulta. */
let vectorWarningShown = false;

/** Identificadores que conviene buscar de forma literal. */
const IDENTIFIER_RE = /[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+|[A-Z]{2,}[0-9]+|\b[A-Za-z]+[A-Z][A-Za-z0-9]*\b/g;

/** Extrae identificadores candidatos de una consulta en texto libre. */
export function extractIdentifiers(query: string): string[] {
  const out = new Set<string>();
  for (const match of query.matchAll(IDENTIFIER_RE)) {
    const token = match[0];
    if (token.length >= 3) out.add(token);
  }
  return Array.from(out);
}

/** Construye una expresión FTS5 segura a partir de los términos de la consulta. */
function buildFtsExpression(query: string): string | null {
  const terms = Array.from(new Set(tokenize(query))).filter((t) => t.length >= 2);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

/** Filtra una lista de tipos de nodo a partir del `scope` solicitado. */
function scopeTypes(scope: string | undefined): string[] | null {
  if (!scope || scope.toLowerCase() === "all") return null;
  const known = ["doc", "code", "test", "taste", "requirement", "decision"];
  const parts = scope
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const valid = parts.filter((p) => known.includes(p));
  return valid.length > 0 ? valid : null;
}

/** Fila interna del FETCH de fragmentos. */
interface ChunkRow {
  id: string;
  node_id: string;
  content: string;
  header_path: string | null;
  req_ids: string | null;
  type: string;
  path: string | null;
  name: string;
  title: string | null;
  status: string | null;
}

/**
 * Ejecuta una consulta híbrida sobre el índice.
 */
export async function search(
  query: string,
  provider: EmbeddingProvider,
  options: QueryOptions = {},
  db: Db = openDb(),
): Promise<SearchResult[]> {
  const limit = options.limit ?? 8;
  const types = scopeTypes(options.scope);
  const pathPrefix = options.pathPrefix;

  const mode = options.mode ?? "hybrid";
  const useLexical = mode !== "vector";
  const useVector = mode !== "lexical";

  const ftsExpr = useLexical ? buildFtsExpression(query) : null;
  const identifiers = useLexical ? extractIdentifiers(query) : [];

  // --- 1. Búsqueda léxica (BM25) ------------------------------------------
  const lexical = new Map<string, { chunk: ChunkRow; bm25: number }>();

  if (ftsExpr) {
    const sql = `
      SELECT c.id, c.node_id, c.content, c.header_path, c.req_ids,
             n.type, n.path, n.name, n.title, n.status,
             bm25(chunks_fts) AS bm25_score
      FROM chunks_fts f
      JOIN chunks c ON c.id = f.chunk_id
      JOIN nodes  n ON n.id = c.node_id
      WHERE chunks_fts MATCH ?
      ORDER BY bm25_score
      LIMIT ?
    `;
    try {
      const rows = db.prepare(sql).all(ftsExpr, limit * 8) as Array<
        ChunkRow & { bm25_score: number }
      >;
      for (const row of rows) {
        lexical.set(row.id, {
          chunk: {
            id: row.id,
            node_id: row.node_id,
            content: row.content,
            header_path: row.header_path,
            req_ids: row.req_ids,
            type: row.type,
            path: row.path,
            name: row.name,
            title: row.title,
            status: row.status,
          },
          bm25: row.bm25_score,
        });
      }
    } catch {
      // Consulta FTS5 mal formada: se ignora la señal léxica en lugar de romper.
    }
  }

  // --- 2. Coincidencia literal de identificadores -------------------------
  const literalHits = new Set<string>();
  if (identifiers.length > 0) {
    const sql = `
      SELECT c.id, c.node_id, c.content, c.header_path, c.req_ids,
             n.type, n.path, n.name, n.title, n.status
      FROM chunks c
      JOIN nodes n ON n.id = c.node_id
      WHERE ${identifiers.map(() => "c.content LIKE ? ESCAPE '\\'").join(" OR ")}
      LIMIT ?
    `;
    const pattern = (s: string): string => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = db.prepare(sql).all(...identifiers.map(pattern), limit * 8) as ChunkRow[];
    for (const row of rows) {
      literalHits.add(row.id);
      if (!lexical.has(row.id)) {
        lexical.set(row.id, { chunk: row, bm25: 0 });
      }
    }
  }

  // --- 3. Búsqueda vectorial ----------------------------------------------
  const vectorRank = new Map<string, { rank: number; distance: number }>();
  const vectorChunks = new Map<string, ChunkRow>();

  try {
    if (!useVector) throw new Error("modo léxico");
    const [qvec] = await provider.embed([query]);
    if (qvec.length !== (provider.dim as number)) {
      throw new Error(
        `Dimensión del vector de consulta (${qvec.length}) distinta de la del proveedor (${provider.dim}).`,
      );
    }
    const k = Math.max(limit * 6, 24);
    const rows = db
      .prepare(
        `SELECT chunk_id, distance FROM chunks_vec
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`,
      )
      .all(qvec, k) as Array<{ chunk_id: string; distance: number }>;

    const ids = rows.map((r) => r.chunk_id);
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const chunkRows = db
        .prepare(
          `SELECT c.id, c.node_id, c.content, c.header_path, c.req_ids,
                  n.type, n.path, n.name, n.title, n.status
           FROM chunks c JOIN nodes n ON n.id = c.node_id
           WHERE c.id IN (${placeholders})`,
        )
        .all(...ids) as ChunkRow[];
      const byId = new Map(chunkRows.map((r) => [r.id, r]));
      rows.forEach((row, idx) => {
        vectorRank.set(row.chunk_id, { rank: idx + 1, distance: row.distance });
        const chunk = byId.get(row.chunk_id);
        if (chunk) vectorChunks.set(row.chunk_id, chunk);
      });
    }
  } catch (err) {
    // El proveedor vectorial puede no estar disponible ahora (cuota agotada,
    // Ollama apagado). La búsqueda léxica sigue siendo válida, así que se
    // avisa una vez y se continúa.
    if (!vectorWarningShown) {
      vectorWarningShown = true;
      process.stderr.write(
        `[nexo-palace] Búsqueda vectorial no disponible: ${(err as Error).message}. ` +
          `Se continúa con la búsqueda léxica.\n`,
      );
    }
  }

  // --- 4. Fusión RRF -------------------------------------------------------
  const RRF_K = 60;
  const scores = new Map<string, number>();
  const bump = (id: string, amount: number): void => {
    scores.set(id, (scores.get(id) ?? 0) + amount);
  };

  const lexicalOrder = Array.from(lexical.keys());
  lexicalOrder.forEach((id, idx) => bump(id, 1 / (RRF_K + idx + 1)));

  const vectorOrder = Array.from(vectorRank.keys());
  vectorOrder.forEach((id, idx) => bump(id, 1 / (RRF_K + idx + 1)));

  // Ventaja explícita para las coincidencias literales de identificadores.
  for (const id of literalHits) bump(id, 0.5);

  // --- 5. Ensamblado y filtrado final -------------------------------------
  const allChunks = new Map<string, ChunkRow>();
  for (const [id, { chunk }] of lexical) allChunks.set(id, chunk);
  for (const [id, chunk] of vectorChunks) allChunks.set(id, chunk);

  const results: SearchResult[] = [];
  for (const [chunkId, score] of scores) {
    const chunk = allChunks.get(chunkId);
    if (!chunk) continue;
    if (types && !types.includes(chunk.type)) continue;
    if (pathPrefix && !(chunk.path ?? "").startsWith(pathPrefix)) continue;

    const lex = lexical.get(chunkId);
    const vec = vectorRank.get(chunkId);

    results.push({
      chunkId,
      nodeId: chunk.node_id,
      nodeType: chunk.type,
      path: chunk.path,
      name: chunk.name,
      title: chunk.title,
      status: chunk.status,
      headerPath: chunk.header_path,
      content: options.includeContent === false ? "" : chunk.content,
      score: Number(score.toFixed(6)),
      lexicalRank: lex ? lexicalOrder.indexOf(chunkId) + 1 : null,
      vectorRank: vec ? vec.rank : null,
      bm25: lex && lex.bm25 !== 0 ? lex.bm25 : null,
      distance: vec ? vec.distance : null,
      literal: literalHits.has(chunkId),
      requirementIds: chunk.req_ids ? chunk.req_ids.split(",").filter(Boolean) : [],
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
