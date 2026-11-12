#!/usr/bin/env node
/**
 * Lanzador de Nexo-Palace.
 *
 * El motor está escrito en TypeScript y se ejecuta con el "type stripping" de
 * Node. A partir de Node 22.18 y 23.6 esa capacidad viene activada de serie;
 * en versiones anteriores hay que pedirla con `--experimental-strip-types`.
 *
 * Este lanzador comprueba si el runtime actual la soporta y, si no, se vuelve a
 * lanzar a sí mismo con la bandera. Se mantiene el mismo `stdio`, de modo que
 * el servidor MCP sigue hablando por el canal correcto.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "src", "cli.ts");

/** `process.features.typescript` existe cuando el type stripping es nativo. */
const nativeTypeStripping =
  typeof process.features.typescript === "string" && process.features.typescript !== "strip-only";

if (nativeTypeStripping) {
  await import(CLI);
} else {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", CLI, ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
