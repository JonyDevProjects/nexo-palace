/**
 * Nexo-Palace — configuración del proyecto indexado.
 *
 * El motor no conoce ningún repositorio concreto: todo lo que depende del
 * proyecto (raíz, qué directorios son documentación, dónde está el código, en
 * qué fichero se acumulan las decisiones) llega desde un `nexo-palace.config.json`
 * que el proyecto declara en su raíz.
 *
 * Resolución, de mayor a menor prioridad:
 *   1. `--root <dir>` o `--config <fichero>` en la línea de comandos.
 *   2. `NEXO_PALACE_CONFIG` / `NEXO_PALACE_ROOT` en el entorno.
 *   3. El `nexo-palace.config.json` más cercano por encima del directorio actual.
 *   4. El directorio actual, con los valores por defecto.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Nombre del fichero de configuración del proyecto. */
export const CONFIG_FILENAME = "nexo-palace.config.json";

/** Configuración efectiva de un proyecto. */
export interface PalaceConfig {
  /** Raíz del proyecto indexado. */
  root: string;
  /** Directorios (relativos a la raíz) cuyo Markdown se indexa como documentación. */
  docs: string[];
  /** Directorios (relativos a la raíz) escaneados por el extractor AST. */
  codeDirs: string[];
  /** Extensiones de código indexables en el grafo. */
  codeExtensions: string[];
  /**
   * Directorios documentales cuyo contenido se marca con el tipo de nodo
   * `taste` en lugar de `doc` (convenciones y decisiones del proyecto).
   */
  tasteDirs: string[];
  /**
   * Fichero (relativo a la raíz) donde se acumulan las decisiones registradas.
   * Su directorio se crea si no existe.
   */
  decisionsFile: string;
  /** Ruta de la base de datos SQLite, relativa a la raíz o absoluta. */
  dbPath: string;
  /** Directorios que nunca se recorren durante el indexado. */
  ignoreDirs: string[];
  /**
   * Prefijos de los IDs de trazabilidad que el proyecto usa en su documentación.
   * `["EPC", "US", "ADR"]` reconoce `EPC-01`, `US-101` y `ADR-003`.
   */
  requirementPrefixes: string[];
  /** Nombre del proyecto, usado en las descripciones del servidor MCP. */
  projectName: string;
}

/** Fichero de configuración tal y como lo escribe el usuario. */
interface RawConfig {
  docs?: string[];
  codeDirs?: string[];
  codeExtensions?: string[];
  tasteDirs?: string[];
  decisionsFile?: string;
  dbPath?: string;
  ignoreDirs?: string[];
  requirementPrefixes?: string[];
  projectName?: string;
}

/**
 * Valores por defecto.
 *
 * Son deliberadamente genéricos: cubren un repositorio de código con `src/` y
 * `docs/` sin obligar a declarar nada. Un proyecto con otra estructura (como
 * `app/`, `components/` o `lib/`) lo declara en su fichero de configuración.
 */
const DEFAULT_CONFIG: Omit<PalaceConfig, "root"> = {
  docs: ["docs"],
  codeDirs: ["src", "lib", "app", "components", "tests", "test", "e2e"],
  codeExtensions: [".ts", ".tsx", ".js", ".jsx"],
  tasteDirs: [],
  decisionsFile: ".nexo-palace/decisions.md",
  dbPath: ".nexo-palace/memory.sqlite3",
  ignoreDirs: [
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".nexo-palace",
    "test-results",
    "playwright-report",
    ".vercel",
  ],
  requirementPrefixes: ["EPC", "US", "ADR", "REQ", "TASK", "WP"],
  projectName: "",
};

let cached: PalaceConfig | null = null;

/**
 * Busca el `nexo-palace.config.json` más cercano por encima de un directorio.
 *
 * Se para en el primer hallazgo: si un repositorio tiene configuración en su
 * raíz, esa manda sobre la de un repositorio padre.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);
  // El bucle termina en la raíz del sistema: `dirname("/")` es `"/"`.
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Lee y valida un fichero de configuración. */
function readConfigFile(path: string): RawConfig {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("el fichero no contiene un objeto JSON");
    }
    return parsed as RawConfig;
  } catch (err) {
    throw new Error(`No se pudo leer ${CONFIG_FILENAME} en ${path}: ${(err as Error).message}`);
  }
}

/** Normaliza una lista de cadenas: recorta, quita vacíos y deduplica. */
function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, ""))
    .filter((v) => v.length > 0);
  return out.length > 0 ? [...new Set(out)] : fallback;
}

/** Nombre de la última parte de una ruta. */
function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Resuelve la configuración efectiva para una raíz de proyecto. */
function buildConfig(root: string, raw: RawConfig): PalaceConfig {
  const docs = stringList(raw.docs, DEFAULT_CONFIG.docs);
  const tasteDirs = stringList(raw.tasteDirs, DEFAULT_CONFIG.tasteDirs);
  const dbPath = (raw.dbPath ?? DEFAULT_CONFIG.dbPath).trim();
  const decisionsFile = (raw.decisionsFile ?? DEFAULT_CONFIG.decisionsFile).trim();

  return {
    root,
    docs,
    codeDirs: stringList(raw.codeDirs, DEFAULT_CONFIG.codeDirs),
    codeExtensions: stringList(raw.codeExtensions, DEFAULT_CONFIG.codeExtensions),
    tasteDirs,
    decisionsFile,
    dbPath: dbPath.startsWith("/") ? dbPath : join(root, dbPath),
    ignoreDirs: stringList(raw.ignoreDirs, DEFAULT_CONFIG.ignoreDirs),
    requirementPrefixes: stringList(raw.requirementPrefixes, DEFAULT_CONFIG.requirementPrefixes),
    projectName: (raw.projectName ?? "").trim() || basename(root),
  };
}

/**
 * Resuelve la configuración del proyecto.
 *
 * Es idempotente: la primera llamada determina la raíz, las siguientes devuelven
 * la misma configuración cacheada. `initProject` fuerza una re-resolución.
 */
export function getConfig(): PalaceConfig {
  if (cached) return cached;
  return initProject();
}

/**
 * Resuelve y fija la configuración del proyecto.
 *
 * @param options.root      Raíz explícita; si se da, se busca el config en ella.
 * @param options.config    Fichero de configuración explícito.
 */
export function initProject(options: { root?: string; config?: string } = {}): PalaceConfig {
  const explicitConfig = options.config ?? process.env.NEXO_PALACE_CONFIG;
  const explicitRoot = options.root ?? process.env.NEXO_PALACE_ROOT;

  let raw: RawConfig = {};
  let root: string;

  if (explicitConfig) {
    const configPath = resolve(explicitConfig);
    if (!existsSync(configPath)) {
      throw new Error(`No existe el fichero de configuración: ${configPath}`);
    }
    raw = readConfigFile(configPath);
    root = explicitRoot ? resolve(explicitRoot) : dirname(configPath);
  } else {
    const startDir = explicitRoot ? resolve(explicitRoot) : process.cwd();
    const found = findConfigFile(startDir);
    if (found) {
      raw = readConfigFile(found);
      root = explicitRoot ? resolve(explicitRoot) : dirname(found);
    } else {
      root = startDir;
    }
  }

  cached = buildConfig(resolve(root), raw);
  return cached;
}

/** Descarta la configuración cacheada (tests). */
export function resetConfig(): void {
  cached = null;
}

/** Raíz del proyecto indexado. */
export function projectRoot(): string {
  return getConfig().root;
}

/** Ruta absoluta de un camino relativo al proyecto. */
export function projectPath(relPath: string): string {
  return relPath.startsWith("/") ? relPath : join(projectRoot(), relPath);
}

/** Ruta de la base de datos. */
export function dbPath(): string {
  return process.env.PALACE_DB_PATH || getConfig().dbPath;
}

/**
 * Carga el `.env` del proyecto, si existe.
 *
 * A diferencia de `process.loadEnvFile()` (que no pisa lo que ya está
 * exportado en la shell), el `.env` del proyecto **tiene prioridad**: es la
 * configuración explícita del repositorio, y una variable antigua exportada en
 * la shell no debe dejar de usar una clave válida.
 *
 * Formato admitido: `CLAVE=valor`, comillas opcionales, `#` para comentarios
 * y prefijo `export` opcional.
 */
export function loadEnv(): void {
  const envPath = join(projectRoot(), ".env");
  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    // Sin `.env`: el motor sigue funcionando con las variables del entorno.
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

/**
 * Dimensión por defecto del vector offline (hash-TF-IDF).
 * Si el proveedor de embeddings configurado usa otra dimensión, el motor
 * detecta el cambio en la tabla `meta` y reindexa el corpus vectorial.
 */
export const OFFLINE_EMBEDDING_DIM = 384;

/**
 * Dimensiones conocidas por proveedor, para validar antes de escribir.
 * Si el proveedor no está en esta tabla se usa la dimensión reportada por él.
 */
export const PROVIDER_DIMS: Record<string, number> = {
  "gemini:text-embedding-004": 768,
  "gemini:text-embedding-005": 768,
  "ollama:nomic-embed-text": 768,
  "ollama:bge-m3": 1024,
  "ollama:mxbai-embed-large": 1024,
  "offline:hash-tfidf": OFFLINE_EMBEDDING_DIM,
};

/** Número máximo de fragmentos devueltos por una consulta híbrida. */
export const DEFAULT_QUERY_LIMIT = 8;

/** Presupuesto de tokens por fragmento al trocear Markdown. */
export const CHUNK_TARGET_CHARS = 1400;

/**
 * Longitud mínima de un fragmento para que merece la pena embeberlo.
 *
 * Los fragmentos muy cortos (encabezados, tablas de una línea) aportan poco
 * valor semántico y consumen cuota: el nivel gratuito de Gemini permite 1000
 * peticiones de embedding al día. Los fragmentos cortos siguen siendo
 * recuperables por la vía léxica (FTS5 y coincidencia literal).
 */
export const MIN_EMBED_CHARS = Number(process.env.PALACE_MIN_EMBED_CHARS || 160);

/**
 * Reglas de exclusión para el indexador documental.
 * Se ignoran los bloques de código ejecutable y los mermaid, que no aportan
 * semántica recuperable y sí contaminan el vector.
 */
export const STRIP_CODE_BLOCKS = true;
