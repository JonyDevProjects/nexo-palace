import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const src = join(ROOT, "src", "schema.sql");
const distDir = join(ROOT, "dist");
const dist = join(distDir, "schema.sql");

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

copyFileSync(src, dist);
