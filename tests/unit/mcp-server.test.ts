import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { initProject, resetConfig } from "../../src/config.ts";
import { closeDb, openDb, rebuildVecTable, upsertEdge, upsertNode } from "../../src/db.ts";
import { detectDrift } from "../../src/drift.ts";
import { runMap } from "../../src/map.ts";
import { pickWorkspaceRoot, resolveRootFromUri, startServer } from "../../src/server.ts";

describe("MCP server dynamic roots, map & drift safeguards", () => {
  const tempDirs: string[] = [];
  const prevRootEnv = process.env.NEXO_PALACE_ROOT;
  const prevCfgEnv = process.env.NEXO_PALACE_CONFIG;
  const prevGeminiKey = process.env.GEMINI_API_KEY;

  function makeTempDir(prefix = "nexo-palace-srv-"): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    closeDb();
    resetConfig();
    if (prevRootEnv === undefined) delete process.env.NEXO_PALACE_ROOT;
    else process.env.NEXO_PALACE_ROOT = prevRootEnv;
    if (prevCfgEnv === undefined) delete process.env.NEXO_PALACE_CONFIG;
    else process.env.NEXO_PALACE_CONFIG = prevCfgEnv;
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGeminiKey;

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveRootFromUri convierte URIs file:// existentes y rechaza inválidas o inexistentes", () => {
    const dir = makeTempDir();
    expect(resolveRootFromUri(pathToFileURL(dir).href)).toBe(dir);
    expect(resolveRootFromUri(pathToFileURL(join(dir, "nope")).href)).toBeNull();
    expect(resolveRootFromUri("https://example.com/repo")).toBeNull();
  });

  it("pickWorkspaceRoot prioriza la raíz con nexo-palace.config.json", () => {
    const plain = makeTempDir("plain-");
    const configured = makeTempDir("configured-");
    writeFileSync(
      join(configured, "nexo-palace.config.json"),
      JSON.stringify({ projectName: "configured-proj" }),
      "utf8",
    );

    const chosen = pickWorkspaceRoot([
      { uri: pathToFileURL(plain).href },
      { uri: pathToFileURL(configured).href },
    ]);
    expect(chosen).toBe(configured);
  });

  it("runMap con bestEffort=true preserva vectores existentes cuando falta el proveedor original", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "README.md"), "# Test\n\n## RF-01\n\nRequisito de prueba.\n", "utf8");
    delete process.env.GEMINI_API_KEY;

    initProject({ root: dir });
    const db = openDb();
    rebuildVecTable(db, 768, "gemini:text-embedding-004");

    const res = await runMap({ db, bestEffort: true });
    expect(res.skipped).toBe(true);
    expect(res.reason).toContain("gemini:text-embedding-004");
    expect(res.stats.provider).toBe("gemini:text-embedding-004");
    expect(res.stats.dim).toBe(768);
  });

  it("detectDrift con mark=false (dry-run) no inserta filas en drift_events ni altera el estado", () => {
    const dir = makeTempDir();
    initProject({ root: dir });
    const db = openDb();

    upsertNode(db, {
      id: "req:RF-01",
      type: "requirement",
      path: "docs/spec.md",
      name: "RF-01",
      status: "active",
      title: "RF-01",
    });
    upsertNode(db, {
      id: "code:src/app.ts",
      type: "code",
      path: "src/app.ts",
      name: "app.ts",
    });
    upsertEdge(db, {
      sourceId: "code:src/app.ts",
      targetId: "req:RF-01",
      relation: "implements",
    });

    const dry = detectDrift({ paths: ["src/app.ts"], mark: false }, db);
    expect(dry.events).toHaveLength(1);
    expect(dry.marked).toEqual([]);

    const rowCount = (db.prepare("SELECT count(*) AS c FROM drift_events").get() as { c: number }).c;
    expect(rowCount).toBe(0);
    const reqNode = db.prepare("SELECT status FROM nodes WHERE id = 'req:RF-01'").get() as {
      status: string;
    };
    expect(reqNode.status).toBe("active");
  });

  it("el servidor MCP re-vincula dinámicamente el proyecto usando MCP roots/list", async () => {
    delete process.env.NEXO_PALACE_ROOT;
    delete process.env.NEXO_PALACE_CONFIG;

    const projectA = makeTempDir("proj-a-");
    const projectB = makeTempDir("proj-b-");
    mkdirSync(join(projectB, "docs"), { recursive: true });
    writeFileSync(
      join(projectB, "nexo-palace.config.json"),
      JSON.stringify({ projectName: "nexo-menu", docs: ["docs"] }),
      "utf8",
    );
    writeFileSync(
      join(projectB, "docs", "carta.md"),
      "# Carta Digital\n\n## EPC-99: Menú público con alérgenos\n\nSoporta filtrado por alérgenos.\n",
      "utf8",
    );

    // Arrancamos en projectA (cwd/root inicial distinto), pero el cliente MCP reporta projectB en roots/list
    const prevCwd = process.cwd();
    process.chdir(projectA);

    try {
      const server = await startServer({ connectTransport: false });
      const client = new Client(
        { name: "test-roots-client", version: "0.1.0" },
        { capabilities: { roots: { listChanged: true } } },
      );

      let currentRoot = projectB;
      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: pathToFileURL(currentRoot).href, name: "active-workspace" }],
      }));

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const statusRes = await client.callTool({ name: "memory_status", arguments: {} });
      const statusText = (statusRes.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      const status = JSON.parse(statusText) as { projectName: string; projectRoot: string };
      expect(status.projectName).toBe("nexo-menu");
      expect(status.projectRoot).toBe(projectB);

      // Ahora el cliente puede mapear projectB y consultar sobre él sin reiniciar el servidor
      const mapRes = await client.callTool({
        name: "memory_map",
        arguments: { provider: "offline" },
      });
      const mapPayload = JSON.parse(
        (mapRes.content as Array<{ type: string; text?: string }>)[0]?.text ?? "",
      ) as { skipped: boolean; projectName: string; docs: { requirements: number } };
      expect(mapPayload.skipped).toBe(false);
      expect(mapPayload.projectName).toBe("nexo-menu");
      expect(mapPayload.docs.requirements).toBeGreaterThan(0);

      const queryRes = await client.callTool({
        name: "memory_query",
        arguments: { query: "alérgenos", limit: 3 },
      });
      const queryPayload = JSON.parse(
        (queryRes.content as Array<{ type: string; text?: string }>)[0]?.text ?? "",
      ) as { project: string; count: number };
      expect(queryPayload.project).toBe("nexo-menu");
      expect(queryPayload.count).toBeGreaterThan(0);

      await client.close();
      await server.close();
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("expone y ejecuta la herramienta MCP memory_path", async () => {
    delete process.env.NEXO_PALACE_ROOT;
    delete process.env.NEXO_PALACE_CONFIG;

    const projectDir = makeTempDir("proj-path-");
    writeFileSync(
      join(projectDir, "nexo-palace.config.json"),
      JSON.stringify({ projectName: "path-test-proj" }),
      "utf8",
    );

    initProject({ root: projectDir });
    const db = openDb();
    upsertNode(db, {
      id: "code:src/entry.ts",
      type: "code",
      path: "src/entry.ts",
      name: "entry.ts",
    });
    upsertNode(db, {
      id: "code:src/service.ts",
      type: "code",
      path: "src/service.ts",
      name: "service.ts",
    });
    upsertNode(db, {
      id: "req:RF-99",
      type: "requirement",
      path: "docs/rf.md",
      name: "RF-99",
    });
    upsertEdge(db, {
      sourceId: "code:src/entry.ts",
      targetId: "code:src/service.ts",
      relation: "depends_on",
      meta: { via: "import" },
    });
    upsertEdge(db, {
      sourceId: "code:src/service.ts",
      targetId: "req:RF-99",
      relation: "implements",
      meta: { via: "annotation" },
    });

    const server = await startServer({ root: projectDir, connectTransport: false });
    const client = new Client(
      { name: "test-path-client", version: "0.1.0" },
      { capabilities: {} },
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toContain("memory_path");

    const pathRes = await client.callTool({
      name: "memory_path",
      arguments: { from: "src/entry.ts", to: "RF-99" },
    });
    const pathText = (pathRes.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    const pathPayload = JSON.parse(pathText) as {
      found: boolean;
      hops: number;
      nodes: Array<{ name: string }>;
      explanation: string;
    };

    expect(pathPayload.found).toBe(true);
    expect(pathPayload.hops).toBe(2);
    expect(pathPayload.nodes.map((n) => n.name)).toEqual(["entry.ts", "service.ts", "RF-99"]);
    expect(pathPayload.explanation).toContain("entry.ts");
    expect(pathPayload.explanation).toContain("RF-99");

    await client.close();
    await server.close();
  });
});
