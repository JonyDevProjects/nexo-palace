import { describe, expect, it } from "vitest";
import { BashExtractor } from "../../src/extractors/bash-extractor.ts";
import type { ExtractorContext } from "../../src/extractors/types.ts";

describe("BashExtractor", () => {
  const extractor = new BashExtractor();

  it("tiene registradas las extensiones shell correctas", () => {
    expect(extractor.name).toBe("bash");
    expect(extractor.extensions).toEqual([".sh", ".bash", ".zsh"]);
  });

  it("extrae la cabecera omitiendo el shebang y captura requisitos a nivel de archivo", () => {
    const script = `#!/usr/bin/env bash
# Script de aprovisionamiento de infraestructura y despliegue
# @implements RF-101
# @implements US-202

echo "Iniciando..."
`;
    const context: ExtractorContext = {
      root: "/repo",
      knownPaths: new Set(),
    };

    const res = extractor.extract("/repo/scripts/deploy.sh", script, context);
    expect(res.relPath).toBe("scripts/deploy.sh");
    expect(res.headerComment).toContain("Script de aprovisionamiento de infraestructura y despliegue");
    expect(res.headerComment).not.toContain("#!");
    expect(res.fileReqIds).toEqual(["RF-101", "US-202"]);
  });

  it("extrae definiciones de funciones tanto POSIX como 'function' con comentarios y requisitos", () => {
    const script = `#!/bin/bash

# Prepara el entorno de ejecución
# @implements RF-102
function prepare_env() {
  echo "Preparando directorios"
}

# Realiza el backup de la base de datos
backup_db() {
  # @implements RF-103
  echo "Haciendo backup"
}
`;
    const context: ExtractorContext = {
      root: "/repo",
      knownPaths: new Set(),
    };

    const res = extractor.extract("/repo/scripts/setup.sh", script, context);
    expect(res.symbols).toHaveLength(2);

    const fn1 = res.symbols.find((s) => s.name === "prepare_env");
    expect(fn1).toBeDefined();
    expect(fn1?.kind).toBe("function");
    expect(fn1?.signature).toBe("prepare_env()");
    expect(fn1?.doc).toContain("Prepara el entorno de ejecución");
    expect(fn1?.reqIds).toEqual(["RF-102"]);

    const fn2 = res.symbols.find((s) => s.name === "backup_db");
    expect(fn2).toBeDefined();
    expect(fn2?.kind).toBe("function");
    expect(fn2?.signature).toBe("backup_db()");
    expect(fn2?.doc).toContain("Realiza el backup de la base de datos");
    expect(fn2?.bodyReqIds).toEqual(["RF-103"]);
  });

  it("extrae variables de entorno y configuración exportadas y globales", () => {
    const script = `#!/bin/bash
# Configuración global
export NODE_ENV="production"
export PORT=8080
declare -x APP_NAME="nexo"
readonly TIMEOUT=60
MAX_RETRIES=5
`;
    const context: ExtractorContext = {
      root: "/repo",
      knownPaths: new Set(),
    };

    const res = extractor.extract("/repo/scripts/env.sh", script, context);
    const varNames = res.symbols.filter((s) => s.kind === "variable").map((s) => s.name);

    expect(varNames).toContain("NODE_ENV");
    expect(varNames).toContain("PORT");
    expect(varNames).toContain("APP_NAME");
    expect(varNames).toContain("TIMEOUT");
    expect(varNames).toContain("MAX_RETRIES");
  });

  it("resuelve dependencias de sourcing (source y .) contra knownPaths", () => {
    const script = `#!/bin/bash
source ./common.sh
. ./config/db.env.sh
source "scripts/logger.sh"
source non_existent.sh
`;
    const context: ExtractorContext = {
      root: "/repo",
      knownPaths: new Set([
        "scripts/common.sh",
        "scripts/config/db.env.sh",
        "scripts/logger.sh",
      ]),
      codeDirs: ["scripts"],
    };

    const res = extractor.extract("/repo/scripts/main.sh", script, context);
    expect(res.importTargets).toContain("scripts/common.sh");
    expect(res.importTargets).toContain("scripts/config/db.env.sh");
    expect(res.importTargets).toContain("scripts/logger.sh");
    expect(res.importTargets).not.toContain("scripts/non_existent.sh");
  });

  it("degrada graciosamente ante scripts heterogéneos o errores sintácticos", () => {
    const brokenScript = `#!/bin/bash
function incomplete( {
  echo 123
`;
    const context: ExtractorContext = {
      root: "/repo",
      knownPaths: new Set(),
    };

    expect(() => {
      const res = extractor.extract("/repo/scripts/broken.sh", brokenScript, context);
      expect(res.relPath).toBe("scripts/broken.sh");
    }).not.toThrow();
  });
});
