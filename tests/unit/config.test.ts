import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initProject, resetConfig } from "../../src/config.ts";
import { walkFiles, isMarkdown } from "../../src/util.ts";

describe("auto-discovery de docs y codeDirs", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "nexo-palace-config-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    resetConfig();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detecta subproyectos de primer nivel como viz-app/src cuando no hay src/ en raíz", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "viz-app", "src"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "pkg", "src"), { recursive: true });

    const cfg = initProject({ root: dir });
    expect(cfg.docs).toEqual(["."]);
    expect(cfg.codeDirs).toEqual(["viz-app/src"]);
  });

  it("hace fallback a ['.'] en codeDirs si no hay carpetas estándar", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "index.ts"), "export const x = 1;\n", "utf8");

    const cfg = initProject({ root: dir });
    expect(cfg.codeDirs).toEqual(["."]);
  });

  it("walkFiles soporta archivos individuales y evita duplicados", () => {
    const dir = makeTempDir();
    const md = join(dir, "README.md");
    writeFileSync(md, "# Hola\n", "utf8");

    const out: string[] = [];
    walkFiles(md, isMarkdown, out);
    walkFiles(dir, isMarkdown, out);
    expect(out).toEqual([md]);
  });
});
