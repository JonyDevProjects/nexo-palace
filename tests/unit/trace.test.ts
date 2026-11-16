import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type Db, upsertNode, upsertEdge } from "../../src/db.ts";
import { findPath, resolveEntity, traceEntity } from "../../src/trace.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function createInMemoryDb(): Db {
  const db = new Database(":memory:") as Db;
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(join(HERE, "../../src/schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

describe("Grafo de Trazabilidad y Resolución (trace.ts)", () => {
  let db: Db;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("Resolución de Entidades (resolveEntity)", () => {
    it("resuelve coincidencia exacta por ruta de archivo ('src/server.ts')", () => {
      upsertNode(db, {
        id: "node-server",
        type: "code",
        path: "src/server.ts",
        name: "server.ts",
        title: "Servidor MCP",
      });

      const { node, candidates } = resolveEntity("src/server.ts", db);

      expect(node).not.toBeNull();
      expect(node!.id).toBe("node-server");
      expect(node!.path).toBe("src/server.ts");
      expect(candidates).toEqual([]);
    });

    it("resuelve por id o por nombre/símbolo cuando hay identificadores únicos", () => {
      upsertNode(db, {
        id: "node-unique",
        type: "code",
        path: "src/engine/unique.ts",
        name: "UniqueProcessor",
        title: "Procesador único",
      });

      // Resolución por ID directo
      const byId = resolveEntity("node-unique", db);
      expect(byId.node).not.toBeNull();
      expect(byId.node!.id).toBe("node-unique");

      // Resolución por nombre
      const byName = resolveEntity("UniqueProcessor", db);
      expect(byName.node).not.toBeNull();
      expect(byName.node!.id).toBe("node-unique");
    });

    it("gestiona ambigüedades devolviendo candidates cuando hay múltiples coincidencias potenciales", () => {
      // Dos archivos con el mismo basename en diferentes carpetas
      upsertNode(db, {
        id: "node-util-core",
        type: "code",
        path: "src/core/utils.ts",
        name: "utils.ts",
      });
      upsertNode(db, {
        id: "node-util-shared",
        type: "code",
        path: "src/shared/utils.ts",
        name: "utils.ts",
      });

      const result = resolveEntity("utils.ts", db);

      expect(result.node).not.toBeNull();
      expect(result.candidates.length).toBeGreaterThan(0);
      const allFoundIds = [result.node!.id, ...result.candidates.map((c) => c.id)];
      expect(allFoundIds).toContain("node-util-core");
      expect(allFoundIds).toContain("node-util-shared");
    });

    it("devuelve null y candidates vacíos cuando la entidad no existe", () => {
      const result = resolveEntity("src/non-existent.ts", db);
      expect(result.node).toBeNull();
      expect(result.candidates).toEqual([]);
    });
  });

  describe("Recorrido del Subgrafo de Trazabilidad (traceEntity)", () => {
    beforeEach(() => {
      // 1. Nodo central de código: src/server.ts
      upsertNode(db, {
        id: "code:server",
        type: "code",
        path: "src/server.ts",
        name: "server.ts",
        title: "Servidor Principal MCP",
      });

      // 2. Requisito directo: RF-01
      upsertNode(db, {
        id: "req:RF-01",
        type: "requirement",
        path: "docs/specs/rf-01.md",
        name: "RF-01",
        title: "Exposición MCP",
      });

      // 3. Historia de usuario asociada al requisito (2 saltos desde src/server.ts)
      upsertNode(db, {
        id: "req:US-101",
        type: "requirement",
        path: "docs/specs/us-101.md",
        name: "US-101",
        title: "Interacción con agente",
      });

      // 4. Test unitario directo: tests/unit/server.test.ts
      upsertNode(db, {
        id: "test:server",
        type: "test",
        path: "tests/unit/server.test.ts",
        name: "server.test.ts",
        title: "Tests del servidor",
      });

      // 5. Dependencia directa saliente (import): src/config.ts
      upsertNode(db, {
        id: "code:config",
        type: "code",
        path: "src/config.ts",
        name: "config.ts",
        title: "Configuración global",
      });

      // 6. Módulo dependiente entrante: src/cli.ts usa src/server.ts
      upsertNode(db, {
        id: "code:cli",
        type: "code",
        path: "src/cli.ts",
        name: "cli.ts",
        title: "Línea de comandos",
      });

      // Aristas:
      // server.ts implements RF-01
      upsertEdge(db, {
        sourceId: "code:server",
        targetId: "req:RF-01",
        relation: "implements",
        meta: { via: "spec-link" },
      });

      // RF-01 implements US-101 (o transitivo)
      upsertEdge(db, {
        sourceId: "req:RF-01",
        targetId: "req:US-101",
        relation: "implements",
        meta: { via: "hierarchy" },
      });

      // server.test.ts tests server.ts
      upsertEdge(db, {
        sourceId: "test:server",
        targetId: "code:server",
        relation: "tests",
        meta: { via: "test-naming" },
      });

      // server.ts depends_on config.ts
      upsertEdge(db, {
        sourceId: "code:server",
        targetId: "code:config",
        relation: "depends_on",
        meta: { via: "import" },
      });

      // cli.ts depends_on server.ts
      upsertEdge(db, {
        sourceId: "code:cli",
        targetId: "code:server",
        relation: "depends_on",
        meta: { via: "import" },
      });
    });

    it("detecta enlaces directos a requisitos asociados, tests y dependencias", () => {
      const trace = traceEntity("src/server.ts", 2, db);

      expect(trace.resolved).not.toBeNull();
      expect(trace.resolved!.path).toBe("src/server.ts");

      // Requisitos asociados
      const rf01 = trace.requirements.find((r) => r.id === "req:RF-01");
      expect(rf01).toBeDefined();
      expect(rf01!.relation).toBe("implements");
      expect(rf01!.distance).toBe(1);

      // Tests que validan el código
      const testEntry = trace.tests.find((t) => t.id === "test:server");
      expect(testEntry).toBeDefined();
      expect(testEntry!.relation).toBe("tests");
      expect(testEntry!.distance).toBe(1);

      // Dependencias (outgoing code: depends_on)
      const depConfig = trace.dependencies.find((d) => d.id === "code:config");
      expect(depConfig).toBeDefined();
      expect(depConfig!.relation).toBe("depends_on");
      expect(depConfig!.distance).toBe(1);

      // Dependientes (incoming code: depends_on)
      const depCli = trace.dependents.find((d) => d.id === "code:cli");
      expect(depCli).toBeDefined();
      expect(depCli!.relation).toBe("depends_on");
      expect(depCli!.distance).toBe(1);
    });

    it("verifica campos relation, distance y via en el grafo", () => {
      const trace = traceEntity("src/server.ts", 2, db);

      // Verificación de enlace directo con 'via'
      const rf01 = trace.requirements.find((r) => r.id === "req:RF-01");
      expect(rf01).toMatchObject({
        id: "req:RF-01",
        name: "RF-01",
        relation: "implements",
        distance: 1,
        via: "spec-link",
      });

      // Verificación de dependencia directa con via: import
      const dep = trace.dependencies.find((d) => d.id === "code:config");
      expect(dep).toMatchObject({
        id: "code:config",
        relation: "depends_on",
        distance: 1,
        via: "import",
      });

      // Verificación de requisito transitivo (distance = 2)
      const us101 = trace.requirements.find((r) => r.id === "req:US-101");
      expect(us101).toBeDefined();
      expect(us101!.distance).toBe(2);
      expect(us101!.relation).toBe("implements");
      expect(us101!.via).toBe("hierarchy");
    });

    it("devuelve subgrafo vacío con candidates si la entidad no existe o es ambigua", () => {
      const trace = traceEntity("src/non-existent.ts", 2, db);
      expect(trace.resolved).toBeNull();
      expect(trace.requirements).toEqual([]);
      expect(trace.tests).toEqual([]);
      expect(trace.dependencies).toEqual([]);
      expect(trace.dependents).toEqual([]);
    });
  });

  describe("Búsqueda de Caminos en el Grafo (findPath)", () => {
    beforeEach(() => {
      // Recreamos el grafo base para pruebas de caminos:
      // test:server --(tests)--> code:server --(implements)--> req:RF-01 --(governed_by)--> req:US-101
      // code:server --(depends_on)--> code:config
      // code:cli --(depends_on)--> code:server
      upsertNode(db, {
        id: "code:server",
        type: "code",
        path: "src/server.ts",
        name: "server.ts",
        title: "Servidor MCP",
      });
      upsertNode(db, {
        id: "req:RF-01",
        type: "requirement",
        path: "docs/specs/rf-01.md",
        name: "RF-01",
        title: "Exposición MCP",
      });
      upsertNode(db, {
        id: "req:US-101",
        type: "requirement",
        path: "docs/specs/us-101.md",
        name: "US-101",
        title: "Interacción con agente",
      });
      upsertNode(db, {
        id: "test:server",
        type: "test",
        path: "tests/unit/server.test.ts",
        name: "server.test.ts",
        title: "Tests del servidor",
      });
      upsertNode(db, {
        id: "code:config",
        type: "code",
        path: "src/config.ts",
        name: "config.ts",
        title: "Configuración",
      });
      upsertNode(db, {
        id: "code:cli",
        type: "code",
        path: "src/cli.ts",
        name: "cli.ts",
        title: "Interfaz de comandos",
      });

      upsertEdge(db, {
        sourceId: "code:server",
        targetId: "req:RF-01",
        relation: "implements",
        meta: { via: "spec-link" },
      });
      upsertEdge(db, {
        sourceId: "req:RF-01",
        targetId: "req:US-101",
        relation: "implements",
        meta: { via: "hierarchy" },
      });
      upsertEdge(db, {
        sourceId: "test:server",
        targetId: "code:server",
        relation: "tests",
        meta: { via: "import" },
      });
      upsertEdge(db, {
        sourceId: "code:server",
        targetId: "code:config",
        relation: "depends_on",
        meta: { via: "import" },
      });
      upsertEdge(db, {
        sourceId: "code:cli",
        targetId: "code:server",
        relation: "depends_on",
        meta: { via: "import" },
      });
    });

    it("encuentra camino directo de 1 salto entre entidades conectadas", () => {
      const res = findPath("src/server.ts", "RF-01", 5, db);
      expect(res.found).toBe(true);
      expect(res.hops).toBe(1);
      expect(res.nodes).toHaveLength(2);
      expect(res.edges).toHaveLength(1);
      expect(res.edges[0]).toMatchObject({
        relation: "implements",
        direction: "outgoing",
        via: "spec-link",
      });
      expect(res.explanation).toContain("server.ts --(implements via spec-link)--> RF-01");
    });

    it("encuentra camino de múltiples saltos conectando test -> código -> requisito -> épica", () => {
      const res = findPath("tests/unit/server.test.ts", "US-101", 6, db);
      expect(res.found).toBe(true);
      expect(res.hops).toBe(3);
      expect(res.nodes.map((n) => n.name)).toEqual(["server.test.ts", "server.ts", "RF-01", "US-101"]);
      expect(res.edges).toHaveLength(3);
      expect(res.edges[0].relation).toBe("tests");
      expect(res.edges[0].direction).toBe("outgoing");
      expect(res.edges[1].relation).toBe("implements");
      expect(res.edges[1].direction).toBe("outgoing");
      expect(res.edges[2].relation).toBe("implements");
      expect(res.edges[2].direction).toBe("outgoing");
      expect(res.explanation).toContain("server.test.ts");
      expect(res.explanation).toContain("US-101");
    });

    it("encuentra camino en sentido inverso (bidireccional / incoming)", () => {
      const res = findPath("src/config.ts", "tests/unit/server.test.ts", 6, db);
      expect(res.found).toBe(true);
      expect(res.hops).toBe(2);
      expect(res.nodes.map((n) => n.name)).toEqual(["config.ts", "server.ts", "server.test.ts"]);
      expect(res.edges[0].direction).toBe("incoming");
      expect(res.edges[1].direction).toBe("incoming");
    });

    it("devuelve 0 saltos cuando ambas entidades son la misma", () => {
      const res = findPath("src/server.ts", "server.ts", 5, db);
      expect(res.found).toBe(true);
      expect(res.hops).toBe(0);
      expect(res.nodes).toHaveLength(1);
      expect(res.edges).toEqual([]);
      expect(res.explanation).toContain("es la misma entidad");
    });

    it("devuelve found=false cuando el camino excede maxHops", () => {
      // test -> server -> RF-01 -> US-101 requiere 3 saltos; con maxHops=2 no debe encontrarlo
      const res = findPath("tests/unit/server.test.ts", "US-101", 2, db);
      expect(res.found).toBe(false);
      expect(res.hops).toBe(-1);
      expect(res.nodes).toEqual([]);
      expect(res.edges).toEqual([]);
      expect(res.explanation).toContain("No se encontró camino");
    });

    it("gestiona entidades inexistentes retornando found=false y mensaje claro", () => {
      const res = findPath("src/inexistente.ts", "RF-01", 5, db);
      expect(res.found).toBe(false);
      expect(res.hops).toBe(-1);
      expect(res.resolvedFrom).toBeNull();
      expect(res.resolvedTo).not.toBeNull();
      expect(res.explanation).toContain("No se pudo resolver la entidad de origen");
    });
  });
});
