#!/usr/bin/env node
/**
 * Lanzador de Nexo-Palace.
 *
 * En producción (paquete NPM), ejecuta el código JavaScript compilado en `dist/cli.js`.
 * Esto garantiza compatibilidad universal y evita la restricción de Node.js que impide
 * realizar type-stripping sobre archivos TypeScript ubicados dentro de node_modules.
 *
 * En desarrollo local sin compilar previa, recurre al código TypeScript en `src/cli.ts`
 * utilizando `--experimental-strip-types` o el soporte nativo de Node.js según aplique.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_CLI = join(HERE, "..", "dist", "cli.js");
const SRC_CLI = join(HERE, "..", "src", "cli.ts");

if (existsSync(DIST_CLI)) {
  await import(DIST_CLI);
} else {
  const nativeTypeStripping =
    typeof process.features.typescript === "string" && process.features.typescript !== "strip-only";

  if (nativeTypeStripping) {
    await import(SRC_CLI);
  } else {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", SRC_CLI, ...process.argv.slice(2)],
      { stdio: "inherit" },
    );
    process.exit(result.status ?? 1);
  }
}
