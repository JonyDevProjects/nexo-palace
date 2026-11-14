import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readJsonFileSecure, writeJsonFileSecure } from "../../src/installer.ts";

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
