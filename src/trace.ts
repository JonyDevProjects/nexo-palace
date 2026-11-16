/**
 * Nexo-Palace Engine — recorrido del grafo de trazabilidad (Fase 2).
 *
 * Resuelve una entidad (archivo, símbolo o ruta) y devuelve su subgrafo:
 * requisitos que la originaron, tests que la validan, documentos que la
 * citan, convenciones de taste aplicables y dependencias reales.
 */
import { type Db, openDb } from "./db.ts";

/** Un nodo resumido del grafo. */
export interface TraceNode {
  id: string;
  type: string;
  path: string | null;
  name: string;
  title: string | null;
  status: string | null;
}

/** Un elemento del subgrafo, con su relación y su distancia al nodo raíz. */
export type TraceEntry = TraceNode & {
  relation: string;
  /** Saltos desde el nodo raíz (1 = enlace directo). */
  distance: number;
  /** Cómo se detectó la relación (p. ej. `import`, `comment`, `path-mention`). */
  via?: string;
};

/** Resultado del trazado. */
export interface TraceResult {
  entity: string;
  resolved: TraceNode | null;
  /** Nodos alternativos cuando la entidad es ambigua. */
  candidates: TraceNode[];
  /** Requisitos (EPC-xx, US-xxx)linked al código. */
  requirements: TraceEntry[];
  /** Tests que validan el código. */
  tests: TraceEntry[];
  /** Documentos que citan el código. */
  documents: TraceEntry[];
  /** Convenciones de taste que aplican. */
  taste: TraceEntry[];
  /** Módulos de los que depende (enlaces directos). */
  dependencies: TraceEntry[];
  /** Módulos que dependen de este (enlaces directos). */
  dependents: TraceEntry[];
  /** Símbolos exportados por el archivo. */
  symbols: TraceEntry[];
  /** Decisiones registradas que mencionan esta entidad. */
  decisions: TraceEntry[];
}

/** Fila de nodo recuperada de la base. */
interface NodeRow {
  id: string;
  type: string;
  path: string | null;
  name: string;
  title: string | null;
  status: string | null;
}

/** Convierte una fila de nodo en el formato de salida. */
function toTraceNode(row: NodeRow): TraceNode {
  return {
    id: row.id,
    type: row.type,
    path: row.path,
    name: row.name,
    title: row.title,
    status: row.status,
  };
}

/**
 * Resuelve una entidad a un nodo del grafo.
 * Prioriza coincidencias exactas de ruta sobre coincidencias parciales.
 */
export function resolveEntity(entity: string, db: Db): { node: NodeRow | null; candidates: NodeRow[] } {
  const clean = entity.trim().replace(/^\.\//, "");
  const base = clean.split("/").pop() ?? clean;

  const all = db.prepare("SELECT id, type, path, name, title, status FROM nodes").all() as NodeRow[];

  const exact = all.find((n) => n.path === clean);
  if (exact) return { node: exact, candidates: [] };

  const byId = all.find((n) => n.id === clean);
  if (byId) return { node: byId, candidates: [] };

  const suffix = all.filter((n) => n.path && n.path.endsWith(`/${clean}`));
  if (suffix.length > 0) return { node: suffix[0], candidates: suffix.slice(1, 6) };

  const byBasename = all.filter((n) => n.path && n.path.split("/").pop() === base);
  if (byBasename.length > 0) return { node: byBasename[0], candidates: byBasename.slice(1, 6) };

  const byName = all.filter((n) => n.name === clean || n.name === base);
  if (byName.length > 0) return { node: byName[0], candidates: byName.slice(1, 6) };

  return { node: null, candidates: [] };
}

/**
 * Devuelve el subgrafo de trazabilidad de una entidad.
 *
 * Las relaciones se clasifican por su distancia al nodo raíz: `dependencies`
 * y `dependents` solo incluyen enlaces directos (distancia 1), mientras que
 * requisitos, tests y documentos pueden aparecer a más de un salto. Cada
 * elemento lleva su `distance` para que el agente distinga lo directo de lo
 * transitivo.
 */
export function traceEntity(entity: string, depth = 2, db: Db = openDb()): TraceResult {
  const { node, candidates } = resolveEntity(entity, db);

  const empty: TraceResult = {
    entity,
    resolved: null,
    candidates: candidates.map(toTraceNode),
    requirements: [],
    tests: [],
    documents: [],
    taste: [],
    dependencies: [],
    dependents: [],
    symbols: [],
    decisions: [],
  };

  if (!node) return empty;

  // --- BFS: distancias en saltos y aristas ---------------------------------
  // Un símbolo hereda el contexto de su archivo: se recorre desde ambos.
  const roots = new Set<string>([node.id]);
  if (node.type === "symbol" && node.path) {
    const parent = db
      .prepare("SELECT source_id FROM edges WHERE target_id = ? AND relation = 'contains'")
      .get(node.id) as { source_id: string } | undefined;
    if (parent) roots.add(parent.source_id);
  }

  const dist = new Map<string, number>();
  for (const root of roots) dist.set(root, 0);
  const edgeRows: Array<{
    source_id: string;
    target_id: string;
    relation: string;
    meta: string | null;
  }> = [];

  let frontier = Array.from(roots);
  for (let d = 0; d < depth; d++) {
    if (frontier.length === 0) break;
    const placeholders = frontier.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT source_id, target_id, relation, meta FROM edges
         WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
      )
      .all(...frontier, ...frontier) as Array<{
      source_id: string;
      target_id: string;
      relation: string;
      meta: string | null;
    }>;
    edgeRows.push(...rows);

    const next = new Set<string>();
    for (const row of rows) {
      for (const id of [row.source_id, row.target_id]) {
        if (!dist.has(id)) {
          dist.set(id, d + 1);
          next.add(id);
        }
      }
    }
    frontier = Array.from(next);
  }

  // --- Clasificación -------------------------------------------------------
  const requirements: TraceEntry[] = [];
  const tests: TraceEntry[] = [];
  const documents: TraceEntry[] = [];
  const taste: TraceEntry[] = [];
  const dependencies: TraceEntry[] = [];
  const dependents: TraceEntry[] = [];
  const symbols: TraceEntry[] = [];
  const decisions: TraceEntry[] = [];

  const nodeCache = new Map<string, NodeRow>();
  const fetchNode = (id: string): NodeRow | undefined => {
    const cached = nodeCache.get(id);
    if (cached) return cached;
    const row = db
      .prepare("SELECT id, type, path, name, title, status FROM nodes WHERE id = ?")
      .get(id) as NodeRow | undefined;
    if (row) nodeCache.set(id, row);
    return row;
  };

  /** Extrae el `via` de los metadatos de la arista. */
  const readVia = (meta: string | null): string | undefined => {
    try {
      return meta ? ((JSON.parse(meta).via as string) ?? undefined) : undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * Añade un nodo a la lista que le corresponde por su tipo.
   * Si el nodo ya estaba, se conserva la distancia menor (la más relevante).
   */
  const classify = (row: NodeRow, relation: string, distance: number, outgoing: boolean, via?: string): void => {
    const listFor = (): TraceEntry[] | null => {
      switch (row.type) {
        case "requirement":
          return requirements;
        case "test":
          return tests;
        case "doc":
          return documents;
        case "taste":
          return taste;
        case "decision":
          return decisions;
        case "symbol":
          return symbols;
        case "code":
          // Las dependencias solo se declaran para enlaces directos.
          if (distance !== 1 || relation !== "depends_on") return null;
          return outgoing ? dependencies : dependents;
        default:
          return null;
      }
    };

    const list = listFor();
    if (!list) return;

    const existing = list.find((x) => x.id === row.id);
    if (existing) {
      if (distance < existing.distance) existing.distance = distance;
      return;
    }

    list.push({
      ...toTraceNode(row),
      relation,
      distance,
      ...(via ? { via } : {}),
    });
  };

  /** Prioridad de relaciones: la más específica gana. */
  const RELATION_PRIORITY: Record<string, number> = {
    tests: 5,
    implements: 4,
    governed_by: 3,
    references: 2,
    contains: 1,
    depends_on: 0,
  };

  /** Aristas directas agrupadas por vecino, con la mejor relación. */
  const directEdges = new Map<string, { relation: string; outgoing: boolean; via?: string }>();

  for (const edge of edgeRows) {
    const dSource = dist.get(edge.source_id);
    const dTarget = dist.get(edge.target_id);
    if (dSource === undefined && dTarget === undefined) continue;

    const via = readVia(edge.meta);
    const isDirect = roots.has(edge.source_id) || roots.has(edge.target_id);

    if (isDirect) {
      // Enlace directo: el vecino es el otro extremo de la arista.
      if (roots.has(edge.source_id) && roots.has(edge.target_id)) continue;
      const outgoing = roots.has(edge.source_id);
      const otherId = outgoing ? edge.target_id : edge.source_id;
      const other = fetchNode(otherId);
      if (!other) continue;

      // Entre dos nodos puede haber varias aristas (`depends_on` y `tests`
      // entre un test y su módulo). Se conserva la más específica.
      const key = `${otherId}`;
      const previous = directEdges.get(key);
      if (previous && RELATION_PRIORITY[previous.relation] >= RELATION_PRIORITY[edge.relation]) {
        continue;
      }
      directEdges.set(key, { relation: edge.relation, outgoing, via });
      continue;
    }

    // Enlace transitivo: se interpreta según el significado de la relación.
    const source = fetchNode(edge.source_id);
    const target = fetchNode(edge.target_id);
    if (!source || !target) continue;

    switch (edge.relation) {
      case "tests":
        // `test --tests--> codigo`: el test valida el código.
        if (source.type === "test") classify(target, edge.relation, (dSource ?? 0) + 1, false, via);
        break;
      case "implements":
        // `codigo --implements--> requisito`.
        classify(target, edge.relation, (dSource ?? 0) + 1, false, via);
        break;
      case "references":
        // `documento --references--> codigo`.
        classify(source, edge.relation, (dTarget ?? 0) + 1, false, via);
        break;
      case "governed_by":
        classify(source, edge.relation, (dTarget ?? 0) + 1, false, via);
        break;
      default:
        // `depends_on` transitivo y `contains` no aportan nada aquí: se omiten
        // para no presentar como directos enlaces que solo lo son a dos saltos.
        break;
    }
  }

  // Los enlaces directos se clasifican al final, cuando ya se sabe cuál es
  // la relación más específica de cada vecino.
  for (const [otherId, info] of directEdges) {
    const other = fetchNode(otherId);
    if (!other) continue;
    classify(other, info.relation, 1, info.outgoing, info.via);
  }

  const byDistance = (a: { distance: number }, b: { distance: number }): number =>
    a.distance - b.distance;

  requirements.sort(byDistance);
  tests.sort(byDistance);
  documents.sort(byDistance);
  taste.sort(byDistance);
  dependencies.sort(byDistance);
  dependents.sort(byDistance);
  symbols.sort(byDistance);
  decisions.sort(byDistance);

  return {
    entity,
    resolved: toTraceNode(node),
    candidates: candidates.map(toTraceNode),
    requirements,
    tests,
    documents,
    taste,
    dependencies,
    dependents,
    symbols,
    decisions,
  };
}

/** Salto individual en el camino encontrado entre dos entidades. */
export interface PathHop {
  from: TraceNode;
  to: TraceNode;
  relation: string;
  direction: "outgoing" | "incoming";
  via?: string;
}

/** Resultado del camino más corto entre dos entidades. */
export interface PathResult {
  from: string;
  to: string;
  resolvedFrom: TraceNode | null;
  resolvedTo: TraceNode | null;
  candidatesFrom: TraceNode[];
  candidatesTo: TraceNode[];
  found: boolean;
  hops: number;
  nodes: TraceNode[];
  edges: PathHop[];
  explanation: string;
}

/**
 * Formatea una explicación legible paso a paso del camino recorrido.
 */
function formatPathExplanation(nodes: TraceNode[], edges: PathHop[]): string {
  if (nodes.length === 0) return "No se encontró camino.";
  if (nodes.length === 1) return `${nodes[0].name} es la misma entidad.`;

  const parts: string[] = [nodes[0].name || nodes[0].id];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const nextNode = nodes[i + 1];
    const nextLabel = nextNode?.name || nextNode?.id || `[nodo ${i + 1}]`;
    const viaText = edge.via ? ` via ${edge.via}` : "";
    if (edge.direction === "outgoing") {
      parts.push(`--(${edge.relation}${viaText})--> ${nextLabel}`);
    } else {
      parts.push(`<--(${edge.relation}${viaText})-- ${nextLabel}`);
    }
  }
  return parts.join(" ");
}

/**
 * Encuentra el camino más corto entre dos entidades en el grafo de trazabilidad
 * utilizando una consulta recursiva (`WITH RECURSIVE`) sobre SQLite.
 */
export function findPath(
  from: string,
  to: string,
  maxHops = 6,
  db: Db = openDb(),
): PathResult {
  const safeMaxHops = Math.max(1, Math.min(maxHops, 20));
  const resFrom = resolveEntity(from, db);
  const resTo = resolveEntity(to, db);

  if (!resFrom.node || !resTo.node) {
    let explanation = "";
    if (!resFrom.node && !resTo.node) {
      explanation = `No se pudieron resolver ni la entidad de origen ('${from}') ni la de destino ('${to}').`;
    } else if (!resFrom.node) {
      explanation =
        resFrom.candidates.length > 0
          ? `La entidad de origen ('${from}') es ambigua (${resFrom.candidates.length} candidatas).`
          : `No se pudo resolver la entidad de origen ('${from}').`;
    } else {
      explanation =
        resTo.candidates.length > 0
          ? `La entidad de destino ('${to}') es ambigua (${resTo.candidates.length} candidatas).`
          : `No se pudo resolver la entidad de destino ('${to}').`;
    }
    return {
      from,
      to,
      resolvedFrom: resFrom.node ? toTraceNode(resFrom.node) : null,
      resolvedTo: resTo.node ? toTraceNode(resTo.node) : null,
      candidatesFrom: resFrom.candidates.map(toTraceNode),
      candidatesTo: resTo.candidates.map(toTraceNode),
      found: false,
      hops: -1,
      nodes: [],
      edges: [],
      explanation,
    };
  }

  const fromNode = resFrom.node;
  const toNode = resTo.node;

  // Si ambas entidades resuelven al mismo nodo
  if (fromNode.id === toNode.id) {
    const traceNode = toTraceNode(fromNode);
    return {
      from,
      to,
      resolvedFrom: traceNode,
      resolvedTo: traceNode,
      candidatesFrom: [],
      candidatesTo: [],
      found: true,
      hops: 0,
      nodes: [traceNode],
      edges: [],
      explanation: `${traceNode.name} (${traceNode.id}) es la misma entidad.`,
    };
  }

  const query = `
    WITH RECURSIVE
      graph_edges AS (
        SELECT source_id AS src, target_id AS dst, relation, 'outgoing' AS direction, meta FROM edges
        UNION ALL
        SELECT target_id AS src, source_id AS dst, relation, 'incoming' AS direction, meta FROM edges
      ),
      paths(curr, path_nodes, path_edges, hops) AS (
        SELECT
          ? AS curr,
          json_array(?),
          json_array(),
          0
        UNION ALL
        SELECT
          ge.dst,
          json_insert(p.path_nodes, '$[#]', ge.dst),
          json_insert(
            p.path_edges,
            '$[#]',
            json_object(
              'from', ge.src,
              'to', ge.dst,
              'relation', ge.relation,
              'direction', ge.direction,
              'meta', ge.meta
            )
          ),
          p.hops + 1
        FROM paths p
        JOIN graph_edges ge ON ge.src = p.curr
        WHERE p.hops < ?
          AND instr(p.path_nodes, '"' || ge.dst || '"') = 0
      )
    SELECT hops, path_nodes, path_edges FROM paths WHERE curr = ? ORDER BY hops ASC LIMIT 1;
  `;

  const row = db
    .prepare(query)
    .get(fromNode.id, fromNode.id, safeMaxHops, toNode.id) as
    | { hops: number; path_nodes: string; path_edges: string }
    | undefined;

  if (!row) {
    return {
      from,
      to,
      resolvedFrom: toTraceNode(fromNode),
      resolvedTo: toTraceNode(toNode),
      candidatesFrom: resFrom.candidates.map(toTraceNode),
      candidatesTo: resTo.candidates.map(toTraceNode),
      found: false,
      hops: -1,
      nodes: [],
      edges: [],
      explanation: `No se encontró camino entre '${fromNode.name}' y '${toNode.name}' en hasta ${safeMaxHops} saltos.`,
    };
  }

  const nodeIds = JSON.parse(row.path_nodes) as string[];
  const rawEdges = JSON.parse(row.path_edges) as Array<{
    from: string;
    to: string;
    relation: string;
    direction: "outgoing" | "incoming";
    meta: string | null;
  }>;

  const placeholders = nodeIds.map(() => "?").join(",");
  const nodeRows = db
    .prepare(
      `SELECT id, type, path, name, title, status FROM nodes WHERE id IN (${placeholders})`,
    )
    .all(...nodeIds) as NodeRow[];
  const nodeMap = new Map(nodeRows.map((r) => [r.id, toTraceNode(r)]));

  const nodes: TraceNode[] = nodeIds.map(
    (id) =>
      nodeMap.get(id) ?? {
        id,
        type: "unknown",
        path: null,
        name: id,
        title: null,
        status: null,
      },
  );

  const edges: PathHop[] = rawEdges.map((e) => {
    let via: string | undefined;
    if (e.meta) {
      try {
        via = (JSON.parse(e.meta).via as string) ?? undefined;
      } catch {
        // ignorar error de parseo en metadatos
      }
    }
    return {
      from: nodeMap.get(e.from) ?? {
        id: e.from,
        type: "unknown",
        path: null,
        name: e.from,
        title: null,
        status: null,
      },
      to: nodeMap.get(e.to) ?? {
        id: e.to,
        type: "unknown",
        path: null,
        name: e.to,
        title: null,
        status: null,
      },
      relation: e.relation,
      direction: e.direction,
      ...(via ? { via } : {}),
    };
  });

  return {
    from,
    to,
    resolvedFrom: toTraceNode(fromNode),
    resolvedTo: toTraceNode(toNode),
    candidatesFrom: resFrom.candidates.map(toTraceNode),
    candidatesTo: resTo.candidates.map(toTraceNode),
    found: true,
    hops: row.hops,
    nodes,
    edges,
    explanation: formatPathExplanation(nodes, edges),
  };
}

export const tracePath = findPath;
