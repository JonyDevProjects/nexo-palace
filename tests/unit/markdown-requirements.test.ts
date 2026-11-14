import { describe, it, expect, beforeEach } from "vitest";
import { extractRequirementIds, normalizeRequirementId } from "../../src/markdown.ts";
import { initProject, resetConfig } from "../../src/config.ts";

describe("diccionario de prefijos y normalización cruzada", () => {
  beforeEach(() => {
    resetConfig();
    initProject();
  });

  it("normaliza alias en inglés a canónico en español para requisitos funcionales y no funcionales", () => {
    expect(normalizeRequirementId("FR-01")).toBe("RF-01");
    expect(normalizeRequirementId("FR-005")).toBe("RF-005");
    expect(normalizeRequirementId("NFR-12")).toBe("RNF-12");
    expect(normalizeRequirementId("NONFUNC-3")).toBe("RNF-03");
  });

  it("normaliza historias de usuario y épicas", () => {
    expect(normalizeRequirementId("HU-101")).toBe("US-101");
    expect(normalizeRequirementId("STORY-42")).toBe("US-42");
    expect(normalizeRequirementId("EPIC-03")).toBe("EPC-03");
    expect(normalizeRequirementId("EPIC 3")).toBe("EPC-03");
  });

  it("normaliza casos de uso, tareas y pruebas", () => {
    expect(normalizeRequirementId("UC-01")).toBe("CU-01");
    expect(normalizeRequirementId("TSK-5")).toBe("TASK-05");
    expect(normalizeRequirementId("TC-12")).toBe("CP-12");
  });

  it("extrae requisitos tanto en inglés como en español de un texto", () => {
    const text = `
      El sistema debe cumplir con FR-001 y además con RF-002.
      Ver también NFR-05 y caso de uso UC-10 o CU-11.
      Historia HU-20 y EPIC 01.
    `;
    const ids = extractRequirementIds(text);
    expect(ids).toContain("RF-001");
    expect(ids).toContain("RF-002");
    expect(ids).toContain("RNF-05");
    expect(ids).toContain("CU-10");
    expect(ids).toContain("CU-11");
    expect(ids).toContain("US-20");
    expect(ids).toContain("EPC-01");
  });
});
