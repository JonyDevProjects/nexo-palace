import { describe, it, expect, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectHarnesses,
  ensurePackageScripts,
  initAgentIntegration,
  installGitHooks,
  resolvePalaceCommand,
  upsertManagedBlock,
} from "../../src/agent-integration.ts";

describe("agent-integration", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "nexo-palace-agent-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upsertManagedBlock inserta y actualiza bloques preservando el resto del archivo", () => {
    const initial = "# Reglas del equipo\n\n- Usa TypeScript estricto.\n";
    const first = upsertManagedBlock(initial, "nexo-palace", "## Bloque 1", "html");
    expect(first).toContain("# Reglas del equipo");
    expect(first).toContain("<!-- nexo-palace:start -->");
    expect(first).toContain("## Bloque 1");

    const withFooter = `${first}\n## Notas finales\n\nNo borrar.\n`;
    const updated = upsertManagedBlock(withFooter, "nexo-palace", "## Bloque 2", "html");
    expect(updated).toContain("# Reglas del equipo");
    expect(updated).toContain("## Bloque 2");
    expect(updated).not.toContain("## Bloque 1");
    expect(updated).toContain("## Notas finales");
  });

  it("upsertManagedBlock soporta marcadores hash para scripts de shell", () => {
    const existing = "#!/bin/sh\necho 'custom hook'\n";
    const updated = upsertManagedBlock(existing, "nexo-palace", "nxpl map --best-effort", "hash");
    expect(updated).toContain("echo 'custom hook'");
    expect(updated).toContain("# --- nexo-palace:start ---");
    expect(updated).toContain("nxpl map --best-effort");

    const replaced = upsertManagedBlock(updated, "nexo-palace", "nxpl drift --dry-run", "hash");
    expect(replaced).toContain("echo 'custom hook'");
    expect(replaced).toContain("nxpl drift --dry-run");
    expect(replaced).not.toContain("nxpl map --best-effort");
  });

  it("detectHarnesses identifica carpetas de configuración en el workspace", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, ".cursor"), { recursive: true });
    mkdirSync(join(dir, ".github"), { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "# Claude\n", "utf8");

    const harnesses = detectHarnesses(dir);
    expect(harnesses).toContain("cursor");
    expect(harnesses).toContain("claude");
    expect(harnesses).toContain("copilot");
  });

  it("initAgentIntegration genera reglas multi-harness, plugin Antigravity sin NEXO_PALACE_ROOT y hook ejecutable", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "nexo-menu", scripts: { test: "vitest" } }, null, 2),
      "utf8",
    );

    const report = initAgentIntegration(dir, {
      harnesses: ["antigravity", "cursor", "claude", "copilot"],
    });

    expect(report.projectName).toBe("nexo-menu");
    expect(existsSync(join(dir, ".agents", "rules", "nexo-palace.md"))).toBe(true);
    expect(existsSync(join(dir, ".cursor", "rules", "nexo-palace.mdc"))).toBe(true);
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(dir, ".github", "copilot-instructions.md"))).toBe(true);

    // Plugin Antigravity sin NEXO_PALACE_ROOT fijo
    const mcpPath = join(dir, ".agents", "plugins", "nexo-palace", "mcp_config.json");
    const mcpCfg = JSON.parse(readFileSync(mcpPath, "utf8")) as {
      mcpServers: { "nexo-palace": { command: string; args: string[]; env?: unknown } };
    };
    expect(mcpCfg.mcpServers["nexo-palace"].command).toBe("npx");
    expect(mcpCfg.mcpServers["nexo-palace"].args).toEqual(["-y", "@ijonydev/nexo-palace", "serve"]);
    expect(mcpCfg.mcpServers["nexo-palace"].env).toBeUndefined();

    // Regla de Cursor tiene alwaysApply: true
    const cursorMdc = readFileSync(join(dir, ".cursor", "rules", "nexo-palace.mdc"), "utf8");
    expect(cursorMdc).toContain("alwaysApply: true");
    expect(cursorMdc).toContain("memory_query");
    expect(cursorMdc).toContain("memory_map");

    // Hook SessionStart de Antigravity produce salida válida por stdout
    const pluginDir = join(dir, ".agents", "plugins", "nexo-palace");
    const hookScript = join(pluginDir, "hooks", "session-start.cjs");
    expect(existsSync(hookScript)).toBe(true);
    const res = spawnSync(process.execPath, [hookScript], {
      cwd: pluginDir,
      input: JSON.stringify({ workspacePaths: [dir], cwd: dir }),
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    const hookOut = JSON.parse(res.stdout) as {
      injectSteps: Array<{ systemMessage: { systemMessage: string } }>;
    };
    expect(hookOut.injectSteps[0].systemMessage.systemMessage).toContain("memory_map");

    // Idempotencia: segunda ejecución no produce cambios
    const second = initAgentIntegration(dir, {
      harnesses: ["antigravity", "cursor", "claude", "copilot"],
    });
    expect(second.changes.every((c) => c.action === "unchanged")).toBe(true);
  });

  it("ensurePackageScripts usa nxpl cuando está instalado y preserva scripts previos", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "consumer-app",
          devDependencies: { "@ijonydev/nexo-palace": "^0.1.3" },
          scripts: { "palace:map": "custom-map" },
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(resolvePalaceCommand(dir)).toBe("nxpl");
    const entry = ensurePackageScripts(dir);
    expect(entry.action).toBe("updated");

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["palace:map"]).toBe("custom-map");
    expect(pkg.scripts["palace:drift"]).toBe("nxpl drift --dry-run");
    expect(pkg.scripts["palace:stats"]).toBe("nxpl stats");
  });

  it("installGitHooks respeta .husky si existe, usa map --best-effort y preserva hooks existentes", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, ".husky"), { recursive: true });
    writeFileSync(join(dir, ".husky", "post-commit"), "#!/bin/sh\necho 'done'\n", "utf8");
    chmodSync(join(dir, ".husky", "post-commit"), 0o755);

    const results = installGitHooks(dir, { strict: true });
    expect(results.map((r) => r.path)).toEqual([".husky/post-commit", ".husky/pre-push"]);

    const postCommit = readFileSync(join(dir, ".husky", "post-commit"), "utf8");
    expect(postCommit).toContain("echo 'done'");
    expect(postCommit).toContain("map --best-effort");
    expect(postCommit).not.toContain("--provider offline");

    const prePush = readFileSync(join(dir, ".husky", "pre-push"), "utf8");
    expect(prePush).toContain("drift --strict");
    expect((statSync(join(dir, ".husky", "pre-push")).mode & 0o111) !== 0).toBe(true);
  });

  it("dryRun simula cambios sin escribir archivos en disco", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dry-repo" }), "utf8");

    const report = initAgentIntegration(dir, {
      harnesses: ["cursor", "claude"],
      dryRun: true,
    });

    expect(report.changes.some((c) => c.action === "created")).toBe(true);
    expect(existsSync(join(dir, ".cursor", "rules", "nexo-palace.mdc"))).toBe(false);
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(dir, ".git", "hooks", "post-commit"))).toBe(false);
  });
});
