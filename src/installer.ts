/**
 * Nexo-Palace — Asistente de instalación cross-platform.
 *
 * Detecta el sistema operativo y guía al usuario por la instalación de
 * proveedores locales de embeddings (litert u ollama).
 *
 * Compatible con: macOS, Linux, Windows (via npm install en WSL o Git Bash)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

/** Lectura segura de JSON (no pisa el archivo si es inválido) */
export function readJsonFileSecure(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Archivo JSON inválido en ${filePath}: ${(err as Error).message}`);
  }
}

/** Escritura atómica con backup y permisos restrictivos (0600) */
export function writeJsonFileSecure(filePath: string, data: Record<string, unknown>): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (existsSync(filePath)) {
    copyFileSync(filePath, `${filePath}.bak`);
  }
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmpPath, filePath);
}
import { platform } from "node:os";
import { confirmPrompt, ProgressBar, selectMenu } from "./tui.ts";
import { openDb } from "./db.ts";
import { createEmbeddingProvider, describeProvider } from "./embedder.ts";
import { ingestDocuments } from "./ingest-docs.ts";
import { extractCode } from "./extract-code.ts";
import { indexStats, setMeta } from "./db.ts";
import { getConfig } from "./config.ts";

const PLATFORM = platform(); // 'darwin', 'linux', 'win32'
const PROJECT_ROOT = process.cwd();
const CONFIG_PATH = join(PROJECT_ROOT, "nexo-palace.config.json");
const ENV_PATH = join(PROJECT_ROOT, ".env");

interface ProviderOption {
  name: string;
  label: string;
  description: string;
  installCommand?: string;
  serviceStart?: string[];
}

// Opciones de instalación por proveedor
const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    name: "litert",
    label: "LiteRT (recomendado)",
    description: "Servicio standalone Python que expone API OpenAI compatible",
  },
  {
    name: "ollama",
    label: "Ollama (más sencillo)",
    description: "Modelos embebidos sin servidor externo adicional",
  },
  {
    name: "offline",
    label: "Offline (sin red, solo BM25 léxico)",
    description: "Sin instalación extra. Búsqueda léxica pura.",
  },
];

// Comandos de instalación según plataforma
function getInstallCommands(provider: string): { pkg: string; cmd: string[]; note: string } | null {
  if (provider === "litert") {
    switch (PLATFORM) {
      case "darwin": // macOS
        return {
          pkg: "pip",
          cmd: ["pip3", "install", "mlc-ai-litert"],
          note: "Requiere Python 3.9+ instalado (brew install python)",
        };
      case "linux":
        return {
          pkg: "pip",
          cmd: ["pip3", "install", "mlc-ai-litert"],
          note: "Asegúrate de tener pip3 disponible",
        };
      default:
        // Windows / other
        return {
          pkg: "pip",
          cmd: ["pip", "install", "mlc-ai-litert"],
          note: "Usa PowerShell o CMD para ejecutar pip",
        };
    }
  } else if (provider === "ollama") {
    switch (PLATFORM) {
      case "darwin": // macOS
        return {
          pkg: "Homebrew",
          cmd: [],
          note: "Instala desde https://ollama.com/download/mac",
        };
      case "linux":
        return {
          pkg: "curl",
          cmd: [],
          note: "curl -fsSL https://ollama.ai/install.sh | sh",
        };
      default:
        return {
          pkg: "chocolatey/scoop",
          cmd: [],
          note: "Instala desde https://ollama.com/download/windows",
        };
    }
  }
  return null;
}

// Detectar si un provider está disponible
async function checkProviderAvailable(name: string, url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function detectProviders(): Promise<{ litert: boolean; ollama: boolean }> {
  const [litert, ollama] = await Promise.all([
    checkProviderAvailable("litert", "http://127.0.0.1:11435/v1/models"),
    checkProviderAvailable("ollama", "http://localhost:11434/api/tags"),
  ]);
  return { litert, ollama };
}

// Mostrar menú interactivo
async function showMenu(): Promise<string> {
  const installed = await detectProviders();

  let initialIndex = 2; // offline por defecto
  if (installed.litert) initialIndex = 0;
  else if (installed.ollama) initialIndex = 1;

  const items = PROVIDER_OPTIONS.map((opt) => {
    let badge: string | undefined;
    if (opt.name === "litert" && installed.litert) badge = "EN EJECUCIÓN";
    if (opt.name === "ollama" && installed.ollama) badge = "EN EJECUCIÓN";
    return {
      value: opt.name,
      label: opt.label,
      description: opt.description,
      badge,
    };
  });

  return selectMenu<string>({
    title: "🔧 Nexo-Palace — Configuración del Arquitecto del Sueño",
    subtitle: `Plataforma: ${PLATFORM === "darwin" ? "macOS" : PLATFORM === "linux" ? "Linux" : "Windows"}`,
    items,
    initialIndex,
  });
}

function printInstallGuide(provider: string): void {
  const cmds = getInstallCommands(provider);
  if (!cmds) return;

  console.log("\n📦 Instrucciones para instalar " + provider.toUpperCase() + ":");
  console.log("");

  if (cmds.cmd.length > 0) {
    console.log(`   1. Instala ${cmds.pkg}:`);
    console.log(`      ${cmds.cmd.join(" ")}`);
    console.log("");
  }

  if (provider === "litert") {
    const startCmd = PLATFORM === "win32" ? "python" : "python3";
    console.log(`   2. Arranca el servicio:`);
    console.log(`      ${startCmd} -m litert.serve --port 11435`);
  } else if (provider === "ollama") {
    if (PLATFORM === "darwin" || PLATFORM === "linux") {
      console.log(`   2. Descarga un modelo de embeddings:`);
      console.log(`      ollama pull nomic-embed-text`);
    }
  }

  if (cmds.note) {
    console.log(`\n   Nota: ${cmds.note}`);
  }

  console.log("");
}

function configureProject(selected: string): void {
  // Actualizar config
  try {
    const config = readJsonFileSecure(CONFIG_PATH);
    if (!config.PALACE_EMBED_PROVIDER) {
      config.PALACE_EMBED_PROVIDER = selected;
      writeJsonFileSecure(CONFIG_PATH, config);
    }
  } catch {
    /* config inválido, ignorar */
  }

  // Crear .env si no existe
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, "# Configuración local de Nexo-Palace\n", { encoding: "utf8", mode: 0o600 });
  }

  console.log(`   ✅ Configuración guardada en nexo-palace.config.json`);
  console.log(`      PALACE_EMBED_PROVIDER = "${selected}"`);
  console.log("");
}

export async function main(): Promise<void> {
  try {
    const selected = await showMenu();
    printInstallGuide(selected);
    configureProject(selected);
    console.log("🎉 Configuración de proveedor guardada.\n");

    const shouldMap = await confirmPrompt("¿Deseas que El Arquitecto cartografíe (mapee) el repositorio ahora?", true);
    if (shouldMap) {
      console.log("\n🏛️  El Arquitecto está iniciando la cartografía del repositorio...\n");
      const db = openDb();
      const provider = await createEmbeddingProvider({ provider: selected });

      process.stderr.write(`\x1b[1m\x1b[36m[arquitecto]\x1b[0m Cartografiando documentos con ${describeProvider(provider)}...\n`);
      const docBar = new ProgressBar(1, "Iniciando análisis documental");
      const docs = await ingestDocuments(provider, {
        db,
        allowProviderSwitch: true,
        onProgress: (current, total, file) => {
          docBar.update(current, file);
        },
      });
      docBar.finish(`Documentos cartografiados: ${docs.documents} (${docs.files} ficheros, ${docs.chunks} fragmentos)`);

      process.stderr.write(`\n\x1b[1m\x1b[36m[arquitecto]\x1b[0m Analizando código y tejiendo grafo de trazabilidad...\n`);
      const codeBar = new ProgressBar(1, "Parseando AST y dependencias");
      const code = await extractCode(provider, {
        db,
        allowProviderSwitch: true,
        onProgress: (current, total, file) => {
          codeBar.update(current, file);
        },
      });
      codeBar.finish(`Código analizado: ${code.files} ficheros, ${code.symbols} símbolos, ${code.tests} tests`);

      setMeta(db, "indexed_at", new Date().toISOString());
      const stats = indexStats(db);

      console.log("\n\x1b[1m\x1b[32m✔ Cartografía completada con éxito\x1b[0m");
      console.log(`  Proyecto: ${getConfig().projectName}`);
      console.log(`  Requisitos detectados: ${docs.requirements}`);
      console.log(`  Aristas del grafo: ${code.edges}`);
      console.log(`  Vectores en memoria: ${stats.vectors} (dim ${stats.dim}, proveedor ${stats.provider})\n`);
    } else {
      console.log("\nPuedes cartografiar tu proyecto en cualquier momento ejecutando:\n  \x1b[36mnxpl map\x1b[0m (o npx nexo-palace map)\n");
    }
  } catch (err) {
    // Si el usuario cancela (Ctrl+C) o hay error, no romper la instalación
    console.log("\n⚠️ Instalación sin configuración automática. Usa PALACE_EMBED_PROVIDER al indexar.\n");
  }
}

// Ejecutar al importar
if (import.meta.url.endsWith(process.argv[1])) {
  main().catch(console.error);
}
