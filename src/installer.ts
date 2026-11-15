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
import { platform, homedir } from "node:os";
import { spawnSync } from "node:child_process";

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

/** Configuración universal del servidor MCP para clientes (Claude Desktop, Cursor, Antigravity, etc.) */
export const NEXO_PALACE_MCP_SERVER_CONFIG = {
  command: "npx",
  args: ["-y", "@ijonydev/nexo-palace", "serve"],
};

/** Inyecta o actualiza la configuración de un servidor MCP en un archivo JSON de forma segura y atómica */
export function injectMcpServerConfig(
  targetFile: string,
  serverName = "nexo-palace",
  serverConfig: Record<string, unknown> = NEXO_PALACE_MCP_SERVER_CONFIG,
): void {
  const current = readJsonFileSecure(targetFile);
  const mcpServers = (current.mcpServers as Record<string, unknown>) || {};
  mcpServers[serverName] = serverConfig;
  current.mcpServers = mcpServers;
  writeJsonFileSecure(targetFile, current);
}

/** Comprueba si un comando ejecutable está disponible en el PATH del sistema */
export function isCommandAvailable(cmd: string): boolean {
  try {
    const lookup = PLATFORM === "win32" ? "where" : "which";
    const res = spawnSync(lookup, [cmd], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

/** Devuelve la ruta por defecto del archivo de configuración de Claude Desktop según el SO */
export function getClaudeConfigPath(): string {
  switch (PLATFORM) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return process.env.APPDATA
        ? join(process.env.APPDATA, "Claude", "claude_desktop_config.json")
        : join(homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json");
    default:
      return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
  }
}

/** Comprueba si Claude Desktop está instalado en el sistema */
export function isClaudeDesktopDetected(customPath?: string): boolean {
  const filePath = customPath ?? getClaudeConfigPath();
  return existsSync(filePath) || existsSync(dirname(filePath));
}

/** Registra Nexo-Palace en Claude Desktop */
export function registerClaudeDesktop(customPath?: string): { success: boolean; path: string; error?: string } {
  const filePath = customPath ?? getClaudeConfigPath();
  try {
    injectMcpServerConfig(filePath);
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, path: filePath, error: (err as Error).message };
  }
}

/** Devuelve la ruta global de configuración MCP para Cursor */
export function getCursorGlobalConfigPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

/** Devuelve la ruta de configuración MCP a nivel de proyecto para Cursor */
export function getCursorProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, ".cursor", "mcp.json");
}

/** Comprueba si Cursor está presente (global, en workspace o comando CLI) */
export function isCursorDetected(projectRoot = PROJECT_ROOT, customGlobalPath?: string): boolean {
  const globalPath = customGlobalPath ?? getCursorGlobalConfigPath();
  return (
    existsSync(globalPath) ||
    existsSync(dirname(globalPath)) ||
    existsSync(join(projectRoot, ".cursor")) ||
    isCommandAvailable("cursor")
  );
}

/** Registra Nexo-Palace en Cursor (a nivel de proyecto si existe .cursor, y a nivel global) */
export function registerCursor(
  projectRoot = PROJECT_ROOT,
  customGlobalPath?: string,
): { success: boolean; paths: string[]; error?: string } {
  const registeredPaths: string[] = [];
  try {
    const projDir = join(projectRoot, ".cursor");
    if (existsSync(projDir)) {
      const projPath = getCursorProjectConfigPath(projectRoot);
      injectMcpServerConfig(projPath);
      registeredPaths.push(projPath);
    }

    const globalPath = customGlobalPath ?? getCursorGlobalConfigPath();
    const globalDir = dirname(globalPath);
    if (existsSync(globalDir) || registeredPaths.length === 0) {
      injectMcpServerConfig(globalPath);
      registeredPaths.push(globalPath);
    }

    return { success: true, paths: registeredPaths };
  } catch (err) {
    return { success: false, paths: registeredPaths, error: (err as Error).message };
  }
}

/** Devuelve la ruta global de configuración MCP para Google Antigravity */
export function getAntigravityGlobalConfigPath(): string {
  return join(homedir(), ".gemini", "config", "mcp_config.json");
}

/** Devuelve la ruta del plugin de workspace para Antigravity */
export function getAntigravityPluginConfigPath(projectRoot: string): string {
  return join(projectRoot, ".agents", "plugins", "nexo-palace", "mcp_config.json");
}

/** Comprueba si Google Antigravity o el plugin de agentes está presente */
export function isAntigravityDetected(projectRoot = PROJECT_ROOT, customGlobalPath?: string): boolean {
  const globalPath = customGlobalPath ?? getAntigravityGlobalConfigPath();
  return (
    isCommandAvailable("agy") ||
    existsSync(globalPath) ||
    existsSync(dirname(globalPath)) ||
    existsSync(join(homedir(), ".gemini")) ||
    existsSync(join(projectRoot, ".agents"))
  );
}

/** Registra Nexo-Palace en Google Antigravity (vía CLI agy, plugin de workspace o mcp_config.json) */
export function registerAntigravity(
  projectRoot = PROJECT_ROOT,
  options?: { customGlobalPath?: string; skipCli?: boolean },
): { success: boolean; method: string; path?: string; error?: string } {
  // 1. Si agy CLI está disponible en el PATH y no se solicita omitir, registrar con agy mcp add
  if (!options?.skipCli && isCommandAvailable("agy")) {
    try {
      const res = spawnSync(
        "agy",
        ["mcp", "add", "nexo-palace", "npx", "--arg=-y", "--arg=@ijonydev/nexo-palace", "--arg=serve"],
        { stdio: "pipe" },
      );
      if (res.status === 0) {
        // Si además existe .agents en el proyecto, sincronizar también el plugin
        if (existsSync(join(projectRoot, ".agents"))) {
          try {
            injectMcpServerConfig(getAntigravityPluginConfigPath(projectRoot));
          } catch {
            /* no bloqueante */
          }
        }
        return { success: true, method: "cli" };
      }
    } catch {
      // Continuar con fallback por archivo
    }
  }

  // 2. Si existe carpeta .agents en el proyecto
  const agentsDir = join(projectRoot, ".agents");
  if (existsSync(agentsDir)) {
    try {
      const pluginMcpPath = getAntigravityPluginConfigPath(projectRoot);
      injectMcpServerConfig(pluginMcpPath);
      return { success: true, method: "workspace-plugin", path: pluginMcpPath };
    } catch (err) {
      return { success: false, method: "workspace-plugin", error: (err as Error).message };
    }
  }

  // 3. Fallback a ~/.gemini/config/mcp_config.json
  const globalPath = options?.customGlobalPath ?? getAntigravityGlobalConfigPath();
  const globalDir = dirname(globalPath);
  if (existsSync(globalDir) || existsSync(join(homedir(), ".gemini"))) {
    try {
      injectMcpServerConfig(globalPath);
      return { success: true, method: "global-config", path: globalPath };
    } catch (err) {
      return { success: false, method: "global-config", path: globalPath, error: (err as Error).message };
    }
  }

  return { success: false, method: "none", error: "Google Antigravity no detectado" };
}

/** Devuelve la ruta de configuración MCP a nivel de proyecto para VS Code */
export function getVsCodeProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, ".vscode", "mcp.json");
}

/** Comprueba si VS Code está presente en el proyecto */
export function isVsCodeDetected(projectRoot = PROJECT_ROOT): boolean {
  return existsSync(join(projectRoot, ".vscode")) || isCommandAvailable("code");
}

/** Registra Nexo-Palace en VS Code si existe la carpeta .vscode en el proyecto */
export function registerVsCode(projectRoot = PROJECT_ROOT): { success: boolean; path?: string; error?: string } {
  const vscodeDir = join(projectRoot, ".vscode");
  if (!existsSync(vscodeDir)) {
    return { success: false, error: ".vscode no detectado en el proyecto" };
  }
  const targetPath = getVsCodeProjectConfigPath(projectRoot);
  try {
    injectMcpServerConfig(targetPath);
    return { success: true, path: targetPath };
  } catch (err) {
    return { success: false, path: targetPath, error: (err as Error).message };
  }
}

export interface McpRegistrationEntry {
  client: string;
  detected: boolean;
  registered: boolean;
  details: string;
}

/** Detecta y auto-registra Nexo-Palace en todos los clientes MCP disponibles */
export function autoRegisterMcpClients(projectRoot = PROJECT_ROOT): McpRegistrationEntry[] {
  const results: McpRegistrationEntry[] = [];

  // Claude Desktop
  const claudeDetected = isClaudeDesktopDetected();
  if (claudeDetected) {
    const reg = registerClaudeDesktop();
    results.push({
      client: "Claude Desktop",
      detected: true,
      registered: reg.success,
      details: reg.success ? `Configurado en ${reg.path}` : `Error: ${reg.error}`,
    });
  } else {
    results.push({
      client: "Claude Desktop",
      detected: false,
      registered: false,
      details: "No detectado en el sistema",
    });
  }

  // Cursor
  const cursorDetected = isCursorDetected(projectRoot);
  if (cursorDetected) {
    const reg = registerCursor(projectRoot);
    results.push({
      client: "Cursor",
      detected: true,
      registered: reg.success,
      details: reg.success ? `Configurado en ${reg.paths.join(", ")}` : `Error: ${reg.error}`,
    });
  } else {
    results.push({
      client: "Cursor",
      detected: false,
      registered: false,
      details: "No detectado en el sistema",
    });
  }

  // Google Antigravity
  const agyDetected = isAntigravityDetected(projectRoot);
  if (agyDetected) {
    const reg = registerAntigravity(projectRoot);
    results.push({
      client: "Google Antigravity",
      detected: true,
      registered: reg.success,
      details: reg.success
        ? reg.method === "cli"
          ? "Registrado mediante 'agy mcp add'"
          : `Configurado en ${reg.path ?? "configuración de Antigravity"}`
        : `Error: ${reg.error}`,
    });
  } else {
    results.push({
      client: "Google Antigravity",
      detected: false,
      registered: false,
      details: "No detectado en el sistema",
    });
  }

  // VS Code (solo si tiene carpeta .vscode en el proyecto)
  if (existsSync(join(projectRoot, ".vscode"))) {
    const reg = registerVsCode(projectRoot);
    results.push({
      client: "VS Code",
      detected: true,
      registered: reg.success,
      details: reg.success ? `Configurado en ${reg.path}` : `Error: ${reg.error}`,
    });
  }

  return results;
}

/** Muestra por pantalla el resultado de la integración MCP */
export function printMcpRegistrationReport(entries: McpRegistrationEntry[]): void {
  const registered = entries.filter((e) => e.registered);
  console.log("\n🔌 Resumen de integración MCP:");

  if (registered.length > 0) {
    for (const r of registered) {
      console.log(`   \x1b[32m✔\x1b[0m ${r.client}: ${r.details}`);
    }
  } else {
    console.log("   \x1b[33mℹ\x1b[0m No se detectaron clientes MCP instalados automáticamente.");
  }

  console.log("\n   Configuración universal recomendada para cualquier cliente MCP:");
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          "nexo-palace": NEXO_PALACE_MCP_SERVER_CONFIG,
        },
      },
      null,
      2,
    )
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n"),
  );
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

    const shouldRegisterMcp = await confirmPrompt(
      "¿Deseas registrar automáticamente Nexo-Palace como servidor MCP en tus clientes instalados (Claude Desktop, Cursor, Antigravity)?",
      true,
    );
    if (shouldRegisterMcp) {
      console.log("\n🔌 Registrando Nexo-Palace en clientes MCP...");
      const report = autoRegisterMcpClients(getConfig().root || PROJECT_ROOT);
      printMcpRegistrationReport(report);
    } else {
      console.log(
        "\nPuedes configurar tu cliente MCP manualmente añadiendo el comando:\n  \x1b[36mnpx -y @ijonydev/nexo-palace serve\x1b[0m\n",
      );
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
