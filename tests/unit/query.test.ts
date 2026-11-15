import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type Db, rebuildVecTable, upsertNode, replaceChunks, insertVector } from "../../src/db.ts";
import { search, type SearchResult } from "../../src/query.ts";
import { type EmbeddingProvider } from "../../src/embedder.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function createInMemoryDb(): Db {
  const db = new Database(":memory:") as Db;
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);
  const schema = readFileSync(join(HERE, "../../src/schema.sql"), "utf8");
  db.exec(schema);
  // Rebuild vector table with dimension 4 for tests
  rebuildVecTable(db, 4, "test-mock");
  return db;
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock:test";
  readonly dim = 4;
  private queryVector: Float32Array;

  constructor(queryVector: Float32Array = new Float32Array([1, 0, 0, 0])) {
    this.queryVector = queryVector;
  }

  setQueryVector(vec: Float32Array) {
    this.queryVector = vec;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => this.queryVector);
  }
}

describe("Motor de Búsqueda y RRF (query.ts)", () => {
  let db: Db;
  let mockProvider: MockEmbeddingProvider;

  beforeEach(() => {
    db = createInMemoryDb();
    mockProvider = new MockEmbeddingProvider();
  });

  afterEach(() => {
    db.close();
  });

  describe("Fusión RRF (Reciprocal Rank Fusion)", () => {
    it("asigna mayor puntuación combinada a elementos que coinciden en búsqueda léxica y vectorial frente a solo una", async () => {
      // Configuramos 3 nodos y fragmentos:
      // Nodo A: Coincide léxicamente ("autenticación") y vectorialmente ([1, 0, 0, 0])
      // Nodo B: Coincide solo léxicamente ("autenticación"), pero vector distante ([0, 0, 1, 0])
      // Nodo C: Coincide solo vectorialmente ([1, 0, 0, 0]), texto diferente ("facturación y pagos")

      upsertNode(db, {
        id: "node-a",
        type: "code",
        path: "src/auth.ts",
        name: "auth.ts",
        title: "Módulo de autenticación",
      });
      replaceChunks(db, "node-a", [
        {
          id: "chunk-a",
          nodeId: "node-a",
          seq: 0,
          content: "Servicio de autenticación para usuarios del sistema con tokens",
        },
      ]);
      insertVector(db, "chunk-a", new Float32Array([1, 0, 0, 0]));

      upsertNode(db, {
        id: "node-b",
        type: "code",
        path: "src/session.ts",
        name: "session.ts",
        title: "Módulo de sesión",
      });
      replaceChunks(db, "node-b", [
        {
          id: "chunk-b",
          nodeId: "node-b",
          seq: 0,
          content: "Manejo de autenticación en sesiones temporales del cliente",
        },
      ]);
      insertVector(db, "chunk-b", new Float32Array([0, 0, 1, 0]));

      upsertNode(db, {
        id: "node-c",
        type: "code",
        path: "src/billing.ts",
        name: "billing.ts",
        title: "Módulo de facturación",
      });
      replaceChunks(db, "node-c", [
        {
          id: "chunk-c",
          nodeId: "node-c",
          seq: 0,
          content: "Generación de facturas electrónicas e impuestos mensuales",
        },
      ]);
      insertVector(db, "chunk-c", new Float32Array([0.9, 0.1, 0, 0]));

      // Query vector busca cercano a [1, 0, 0, 0]
      mockProvider.setQueryVector(new Float32Array([1, 0, 0, 0]));

      const results = await search(
        "autenticación",
        mockProvider,
        { mode: "hybrid", limit: 5 },
        db,
      );

      const resA = results.find((r) => r.chunkId === "chunk-a");
      const resB = results.find((r) => r.chunkId === "chunk-b");
      const resC = results.find((r) => r.chunkId === "chunk-c");

      expect(resA).toBeDefined();
      expect(resB).toBeDefined();
      expect(resC).toBeDefined();

      // chunk-a debe tener rank léxico y rank vectorial
      expect(resA!.lexicalRank).not.toBeNull();
      expect(resA!.vectorRank).not.toBeNull();

      // chunk-a debe superar en score a chunk-b (solo léxico destacado) y chunk-c (solo vectorial)
      expect(resA!.score).toBeGreaterThan(resB!.score);
      expect(resA!.score).toBeGreaterThan(resC!.score);
      expect(results[0].chunkId).toBe("chunk-a");
    });
  });

  describe("Modo 'lexical'", () => {
    it("busca solo por coincidencia de texto FTS5 y coincidencia literal de IDs ignorando KNN", async () => {
      upsertNode(db, {
        id: "node-req1",
        type: "requirement",
        path: "docs/specs/req1.md",
        name: "EPC-01",
        title: "Épica de Seguridad",
      });
      replaceChunks(db, "node-req1", [
        {
          id: "chunk-req1",
          nodeId: "node-req1",
          seq: 0,
          content: "Requisito EPC-01: Control de accesos y permisos RBAC",
          requirementIds: ["EPC-01"],
        },
      ]);
      insertVector(db, "chunk-req1", new Float32Array([0, 1, 0, 0]));

      upsertNode(db, {
        id: "node-other",
        type: "code",
        path: "src/other.ts",
        name: "other.ts",
      });
      replaceChunks(db, "node-other", [
        {
          id: "chunk-other",
          nodeId: "node-other",
          seq: 0,
          content: "Procesador de datos no relacionado",
        },
      ]);
      // Vector idéntico a la consulta vectorial para verificar que en modo léxico NO se toma en cuenta
      insertVector(db, "chunk-other", new Float32Array([1, 0, 0, 0]));

      mockProvider.setQueryVector(new Float32Array([1, 0, 0, 0]));

      const results = await search(
        "EPC-01",
        mockProvider,
        { mode: "lexical" },
        db,
      );

      expect(results.length).toBeGreaterThan(0);
      const hit = results.find((r) => r.chunkId === "chunk-req1");
      expect(hit).toBeDefined();
      expect(hit!.literal).toBe(true);
      expect(hit!.vectorRank).toBeNull();
      expect(hit!.distance).toBeNull();

      // El chunk-other que solo coincidía por vector no debe aparecer
      const otherHit = results.find((r) => r.chunkId === "chunk-other");
      expect(otherHit).toBeUndefined();
    });

    it("no falla si el proveedor vectorial arroja error en modo lexical", async () => {
      const failingProvider: EmbeddingProvider = {
        name: "failing",
        dim: 4,
        async embed() {
          throw new Error("Conexión rechazada con el proveedor");
        },
      };

      upsertNode(db, {
        id: "node-text",
        type: "doc",
        path: "docs/readme.md",
        name: "readme",
      });
      replaceChunks(db, "node-text", [
        {
          id: "chunk-text",
          nodeId: "node-text",
          seq: 0,
          content: "Documentación principal del proyecto nexo-palace",
        },
      ]);

      const results = await search(
        "nexo-palace",
        failingProvider,
        { mode: "lexical" },
        db,
      );

      expect(results.length).toBe(1);
      expect(results[0].chunkId).toBe("chunk-text");
    });
  });

  describe("Modo 'vector'", () => {
    it("devuelve resultados basados únicamente en distancia vectorial usando mock provider", async () => {
      upsertNode(db, {
        id: "node-v1",
        type: "code",
        path: "src/v1.ts",
        name: "v1.ts",
      });
      replaceChunks(db, "node-v1", [
        {
          id: "chunk-v1",
          nodeId: "node-v1",
          seq: 0,
          content: "Texto completamente arbitrario alfa",
        },
      ]);
      insertVector(db, "chunk-v1", new Float32Array([1, 0, 0, 0]));

      upsertNode(db, {
        id: "node-v2",
        type: "code",
        path: "src/v2.ts",
        name: "v2.ts",
      });
      replaceChunks(db, "node-v2", [
        {
          id: "chunk-v2",
          nodeId: "node-v2",
          seq: 0,
          content: "Texto que contiene la palabra clave beta exacta",
        },
      ]);
      insertVector(db, "chunk-v2", new Float32Array([0, 0, 1, 0]));

      // Query vector apunta a [1, 0, 0, 0]
      mockProvider.setQueryVector(new Float32Array([1, 0, 0, 0]));

      // Buscamos con texto "beta" pero en mode: "vector"
      const results = await search(
        "beta",
        mockProvider,
        { mode: "vector" },
        db,
      );

      expect(results.length).toBeGreaterThan(0);
      // El primero debe ser chunk-v1 por cercanía vectorial, a pesar de que "beta" estaba en v2
      expect(results[0].chunkId).toBe("chunk-v1");
      expect(results[0].vectorRank).toBe(1);
      expect(results[0].lexicalRank).toBeNull();
      expect(results[0].bm25).toBeNull();
    });
  });

  describe("Filtros de ámbito (scope) y prefijos de ruta (pathPrefix)", () => {
    beforeEach(() => {
      upsertNode(db, {
        id: "req-1",
        type: "requirement",
        path: "docs/rf/rf-01.md",
        name: "RF-01",
      });
      replaceChunks(db, "req-1", [
        {
          id: "c-req1",
          nodeId: "req-1",
          seq: 0,
          content: "Definición del requisito RF-01 de arquitectura",
        },
      ]);

      upsertNode(db, {
        id: "code-1",
        type: "code",
        path: "src/core/engine.ts",
        name: "engine.ts",
      });
      replaceChunks(db, "code-1", [
        {
          id: "c-code1",
          nodeId: "code-1",
          seq: 0,
          content: "Implementación del motor en src core arquitectura",
        },
      ]);

      upsertNode(db, {
        id: "code-2",
        type: "code",
        path: "src/adapters/http.ts",
        name: "http.ts",
      });
      replaceChunks(db, "code-2", [
        {
          id: "c-code2",
          nodeId: "code-2",
          seq: 0,
          content: "Adaptador HTTP para comunicación y arquitectura de red",
        },
      ]);
    });

    it("filtra correctamente por scope: 'requirement'", async () => {
      const results = await search(
        "arquitectura",
        mockProvider,
        { scope: "requirement", mode: "lexical" },
        db,
      );

      expect(results.length).toBe(1);
      expect(results[0].nodeType).toBe("requirement");
      expect(results[0].chunkId).toBe("c-req1");
    });

    it("filtra correctamente por scope: 'code'", async () => {
      const results = await search(
        "arquitectura",
        mockProvider,
        { scope: "code", mode: "lexical" },
        db,
      );

      expect(results.length).toBe(2);
      expect(results.every((r) => r.nodeType === "code")).toBe(true);
    });

    it("acota resultados que comiencen por un pathPrefix determinado", async () => {
      const results = await search(
        "arquitectura",
        mockProvider,
        { pathPrefix: "src/core/", mode: "lexical" },
        db,
      );

      expect(results.length).toBe(1);
      expect(results[0].chunkId).toBe("c-code1");
      expect(results[0].path).toBe("src/core/engine.ts");
    });
  });
});
