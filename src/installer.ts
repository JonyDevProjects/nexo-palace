/**
 * Nexo-Palace — Asistente de instalación cross-platform.
 *
 * Detecta el sistema operativo y guía al usuario por la instalación de
 * proveedores locales de embeddings (litert u ollama).
 *
 * Compatible con: macOS, Linux, Windows (via npm install en WSL o Git Bash)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

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
  console.log("\n🔧 Nexo-Palace — Instalación de Embeddings Locales\n");
  console.log(`   Plataforma: ${PLATFORM === "darwin" ? "macOS" : PLATFORM === "linux" ? "Linux" : "Windows"}`);
  console.log("");

  const installed = await detectProviders();

  // Preseleccionar opción si hay algo ya corriendo
  let selectedIndex = 2; // offline por defecto
  let optionsHtml = "";

  for (let i = 0; i < PROVIDER_OPTIONS.length; i++) {
    const opt = PROVIDER_OPTIONS[i];
    const marker = i === selectedIndex ? "▸" : " ";
    const runningTag =
      (opt.name === "litert" && installed.litert) || (opt.name === "ollama" && installed.ollama)
        ? " [✅ EN EJECUCIÓN]"
        : "";
    optionsHtml += `   ${marker} ${i + 1}. ${opt.label}${runningTag}\n`;
    optionsHtml += `       ${opt.description}\n\n`;
  }

  optionsHtml += `   Escoge número (1-3): `;

  process.stdout.write(optionsHtml);
  return new Promise((resolve) => {
    process.stdin.once("data", (data) => {
      const choice = parseInt(data.toString().trim());
      if (choice >= 1 && choice <= 3) {
        resolve(PROVIDER_OPTIONS[choice - 1].name);
      } else {
        resolve(PROVIDER_OPTIONS[selectedIndex].name);
      }
    });
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
  const configContent = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : "{}";
  try {
    const config = JSON.parse(configContent);
    if (!config.PALACE_EMBED_PROVIDER) {
      config.PALACE_EMBED_PROVIDER = selected;
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
    }
  } catch {
    /* config inválido, ignorar */
  }

  // Crear .env si no existe
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, "# Configuración local de Nexo-Palace\n", "utf8");
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
    console.log("🎉 Instalación completada.\n");
  } catch (err) {
    // Si el usuario cancela (Ctrl+C) o hay error, no romper la instalación
    console.log("\n⚠️ Instalación sin configuración automática. Usa PALACE_EMBED_PROVIDER al indexar.\n");
  }
}

// Ejecutar al importar
if (import.meta.url.endsWith(process.argv[1])) {
  main().catch(console.error);
}
