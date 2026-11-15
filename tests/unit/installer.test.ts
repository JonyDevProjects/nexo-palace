import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readJsonFileSecure,
  writeJsonFileSecure,
  injectMcpServerConfig,
  registerClaudeDesktop,
  registerCursor,
  registerAntigravity,
  registerVsCode,
  autoRegisterMcpClients,
  NEXO_PALACE_MCP_SERVER_CONFIG,
} from "../../src/installer.ts";

describe("installer security helpers", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "nexo-palace-installer-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readJsonFileSecure devuelve {} si el archivo no existe o está vacío", () => {
    const dir = makeTempDir();
    expect(readJsonFileSecure(join(dir, "missing.json"))).toEqual({});

    const emptyFile = join(dir, "empty.json");
    writeFileSync(emptyFile, "   \n", "utf8");
    expect(readJsonFileSecure(emptyFile)).toEqual({});
  });

  it("readJsonFileSecure lanza error si el JSON es inválido (no lo sobrescribe)", () => {
    const dir = makeTempDir();
    const badFile = join(dir, "bad.json");
    writeFileSync(badFile, "{ invalid json", "utf8");
    expect(() => readJsonFileSecure(badFile)).toThrow(/JSON inválido/);
  });

  it("writeJsonFileSecure escribe con permisos 0600, crea backup y preserva claves previas", () => {
    const dir = makeTempDir();
    const target = join(dir, "sub", "config.json");

    writeJsonFileSecure(target, { mcpServers: { other: { command: "echo" } } });
    expect(existsSync(target)).toBe(true);
    expect(existsSync(`${target}.bak`)).toBe(false);
    expect(statSync(target).mode & 0o777).toBe(0o600);

    // Segunda escritura debe crear .bak y mantener 0600
    const existing = readJsonFileSecure(target);
    writeJsonFileSecure(target, { ...existing, PALACE_EMBED_PROVIDER: "litert" });

    expect(existsSync(`${target}.bak`)).toBe(true);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    const updated = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    expect(updated.mcpServers).toEqual({ other: { command: "echo" } });
    expect(updated.PALACE_EMBED_PROVIDER).toBe("litert");
  });
});

describe("MCP client integration & auto-registration", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "nexo-palace-mcp-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injectMcpServerConfig registra nexo-palace con npx -y @ijonydev/nexo-palace serve y preserva servidores existentes", () => {
    const dir = makeTempDir();
    const target = join(dir, "config.json");

    // Archivo preexistente con otro servidor y configuración
    writeJsonFileSecure(target, {
      theme: "dark",
      mcpServers: {
        existingServer: {
          command: "node",
          args: ["existing.js"],
        },
      },
    });

    injectMcpServerConfig(target);

    const updated = readJsonFileSecure(target);
    expect(updated.theme).toBe("dark");
    const servers = updated.mcpServers as Record<string, any>;
    expect(servers.existingServer).toEqual({ command: "node", args: ["existing.js"] });
    expect(servers["nexo-palace"]).toEqual(NEXO_PALACE_MCP_SERVER_CONFIG);
    expect(servers["nexo-palace"].command).toBe("npx");
    expect(servers["nexo-palace"].args).toEqual(["-y", "@ijonydev/nexo-palace", "serve"]);
  });

  it("registerClaudeDesktop inyecta la configuración en la ruta indicada", () => {
    const dir = makeTempDir();
    const claudeConfig = join(dir, "claude_desktop_config.json");

    const result = registerClaudeDesktop(claudeConfig);
    expect(result.success).toBe(true);
    expect(result.path).toBe(claudeConfig);

    const parsed = readJsonFileSecure(claudeConfig);
    const servers = parsed.mcpServers as Record<string, any>;
    expect(servers["nexo-palace"]).toEqual(NEXO_PALACE_MCP_SERVER_CONFIG);
  });

  it("registerCursor configura proyecto si existe .cursor y global si se indica", () => {
    const dir = makeTempDir();
    const projectRoot = join(dir, "my-project");
    mkdirSync(join(projectRoot, ".cursor"), { recursive: true });
    const globalPath = join(dir, "global", ".cursor", "mcp.json");
    mkdirSync(join(dir, "global", ".cursor"), { recursive: true });

    const result = registerCursor(projectRoot, globalPath);
    expect(result.success).toBe(true);
    expect(result.paths).toContain(join(projectRoot, ".cursor", "mcp.json"));
    expect(result.paths).toContain(globalPath);

    const projParsed = readJsonFileSecure(join(projectRoot, ".cursor", "mcp.json"));
    expect((projParsed.mcpServers as Record<string, any>)["nexo-palace"]).toEqual(NEXO_PALACE_MCP_SERVER_CONFIG);

    const globalParsed = readJsonFileSecure(globalPath);
    expect((globalParsed.mcpServers as Record<string, any>)["nexo-palace"]).toEqual(NEXO_PALACE_MCP_SERVER_CONFIG);
  });

  it("registerAntigravity registra en workspace plugin si existe .agents", () => {
    const dir = makeTempDir();
    const projectRoot = join(dir, "project-with-agents");
    mkdirSync(join(projectRoot, ".agents"), { recursive: true });

    const result = registerAntigravity(projectRoot, { skipCli: true });
    expect(result.success).toBe(true);
    expect(result.method).toBe("workspace-plugin");
    expect(result.path).toBe(join(projectRoot, ".agents", "plugins", "nexo-palace", "mcp_config.json"));

    const pluginConfig = readJsonFileSecure(result.path!);
    expect((pluginConfig.mcpServers as Record<string, any>)["nexo-palace"]).toEqual(NEXO_PALACE_MCP_SERVER_CONFIG);
  });

  it("registerAntigravity hace fallback a global-config si no hay .agents ni CLI", () => {
    const dir = makeTempDir();
    const projectRoot = join(dir, "plain-project");
    mkdirSync(projectRoot, { recursive: true });
    const globalPath = join(dir, ".gemini", "config", "mcp_config.json");
    mkdirSync(join(dir, ".gemini", "config"), { recursive: true });

    const result = registerAntigravity(projectRoot, { customGlobalPath: globalPath, skipCli: true });
    expect(result.success).toBe(true);
    expect(result.method).toBe("global-config");
    expect(result.path).toBe(globalPath);

    const globalConfig = readJsonFileSecure(globalPath);
    expect((globalConfig.mcpServers as Record<string, any>)["nexo-palace"]).toEqual(NEXO_PALACE_MCP_SERVER_CONFIG);
  });

  it("registerAntigravity limpia NEXO_PALACE_ROOT fijo en configuración legacy si existe", () => {
    const dir = makeTempDir();
    const projectRoot = join(dir, "repo-with-agents");
    mkdirSync(join(projectRoot, ".agents"), { recursive: true });

    const legacyPath = join(dir, ".gemini", "antigravity", "mcp_config.json");
    writeJsonFileSecure(legacyPath, {
      mcpServers: {
        "nexo-palace": {
          command: "npx",
          args: ["-y", "@ijonydev/nexo-palace", "serve"],
          env: { NEXO_PALACE_ROOT: "/ruta/fija/incorrecta" },
        },
        otherServer: { command: "echo" },
      },
    });

    const result = registerAntigravity(projectRoot, { customLegacyPath: legacyPath, skipCli: true });
    expect(result.success).toBe(true);

    const legacyParsed = readJsonFileSecure(legacyPath);
    const servers = legacyParsed.mcpServers as Record<string, any>;
    expect(servers["nexo-palace"]).toEqual(NEXO_PALACE_MCP_SERVER_CONFIG);
    expect(servers["nexo-palace"].env).toBeUndefined();
    expect(servers.otherServer).toEqual({ command: "echo" });
  });

  it("registerVsCode registra en .vscode/mcp.json si la carpeta existe", () => {
    const dir = makeTempDir();
    const projectRoot = join(dir, "my-vscode-project");

    // Sin .vscode debe fallar suavemente
    expect(registerVsCode(projectRoot).success).toBe(false);

    // Con .vscode debe registrar correctamente
    mkdirSync(join(projectRoot, ".vscode"), { recursive: true });
    const result = registerVsCode(projectRoot);
    expect(result.success).toBe(true);
    expect(result.path).toBe(join(projectRoot, ".vscode", "mcp.json"));

    const parsed = readJsonFileSecure(result.path!);
    expect((parsed.mcpServers as Record<string, any>)["nexo-palace"]).toEqual(NEXO_PALACE_MCP_SERVER_CONFIG);
  });

  it("autoRegisterMcpClients retorna informe estructurado de clientes", () => {
    const dir = makeTempDir();
    const projectRoot = join(dir, "test-repo");
    mkdirSync(projectRoot, { recursive: true });

    const entries = autoRegisterMcpClients(projectRoot);
    expect(Array.isArray(entries)).toBe(true);
    const clientNames = entries.map((e) => e.client);
    expect(clientNames).toContain("Claude Desktop");
    expect(clientNames).toContain("Cursor");
    expect(clientNames).toContain("Google Antigravity");
  });
});
