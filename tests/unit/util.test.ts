// util.test.ts — Pruebas unitarias de utilidades (hashText, nodeId, walkFiles)
import { describe, it, expect } from "vitest";
import { hashText, nodeId, isMarkdown, walkFiles } from "../../src/util";

describe("hashText", () => {
  it("produce un string hexadecimal para cualquier cadena no vacía", () => {
    const h = hashText("hola");
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(0);
    // debe ser un hash hexadecimal válido
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });

  it("es determinista: mismo input siempre da mismo output", () => {
    const text = "texto repetido x847j";
    expect(hashText(text)).toBe(hashText(text));
  });

  it("distingue textos diferentes", () => {
    expect(hashText("a")).not.toBe(hashText("b"));
  });

  it("es sensible a mayúsculas/minúsculas (no colapsa casos)", () => {
    expect(hashText("Hola")).not.toBe(hashText("hola"));
  });

  it("maneja cadenas vacías sin lanzar", () => {
    expect(() => hashText("")).not.toThrow();
    // cadena vacía produce el seed djb2
    expect(hashText("")).toMatch(/^[0-9a-f]+$/);
  });
});

describe("nodeId", () => {
  it("genera un identificador con prefijo y clave concatenados", () => {
    const id = nodeId("file", "src/reader.ts");
    expect(id).toMatch(/^file:/);
    expect(id).toContain("src/reader.ts");
  });

  it("es determinista", () => {
    expect(nodeId("chunk", "docs/spec.md")).toBe(nodeId("chunk", "docs/spec.md"));
  });

  it("distingue claves dentro del mismo tipo", () => {
    expect(nodeId("file", "src/reader.ts")).not.toBe(nodeId("file", "src/helper.ts"));
  });

  it("distingue tipos incluso con misma clave", () => {
    expect(nodeId("file", "X")).not.toBe(nodeId("chunk", "X"));
  });
});

describe("isMarkdown", () => {
  it("reconoce extensiones markdown (case-insensitive)", () => {
    expect(isMarkdown("README.md")).toBe(true);
    expect(isMarkdown("docs/guide.md")).toBe(true);
    expect(isMarkdown("guide.MD")).toBe(true);
    expect(isMarkdown("README.Md")).toBe(true);
  });

  it("rechaza extensiones no-markdown", () => {
    expect(isMarkdown("app.ts")).toBe(false);
    expect(isMarkdown("config.json")).toBe(false);
    expect(isMarkdown("index.html")).toBe(false);
    expect(isMarkdown("package.txt")).toBe(false);
  });
});

describe("walkFiles", () => {
  it("devuelve solo archivos que coinciden con el filtro", () => {
    const results = walkFiles(".", (file: string) => file.endsWith(".ts"));
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    results.forEach((p) => expect(p).toMatch(/\.ts$/));
  });

  it("devuelve array vacío si no hay coincidencias", () => {
    const results = walkFiles(".", (file: string) => file.endsWith(".xyz"));
    expect(results).toEqual([]);
  });
});
