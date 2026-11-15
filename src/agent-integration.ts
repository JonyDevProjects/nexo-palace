/**
 * Nexo-Palace — Generador de integración para agentes y automatización del ciclo de vida.
 *
 * Cubre los ejes de adopción en proyectos:
 *   - Reglas operativas multi-harness (Antigravity, Cursor, Claude Code, Copilot).
 *   - Plugin de workspace para Antigravity (manifest, mcp_config, rules, skill y SessionStart hook).
 *   - Scripts npm en `package.json` (`palace:map`, `palace:drift`, `palace:stats`).
 *   - Git hooks seguros (`post-commit` con `map --best-effort` y `pre-push` con `drift`).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isCommandAvailable, NEXO_PALACE_MCP_SERVER_CONFIG, readJsonFileSecure } from "./installer.ts";

export const HARNESS_IDS = ["antigravity", "cursor", "claude", "copilot"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export interface FileChangeEntry {
  path: string;
  action: "created" | "updated" | "unchanged" | "skipped";
  kind: "rule" | "plugin" | "scripts" | "git-hook";
  reason?: string;
}

export interface InitAgentOptions {
  /** Harnesses a configurar; por defecto se autodetectan (con fallback a antigravity, cursor, claude). */
  harnesses?: HarnessId[];
  /** Si es true, añade scripts `palace:*` a `package.json` cuando exista. */
  scripts?: boolean;
  /** Si es true, instala Git hooks (`post-commit` y `pre-push`). */
  gitHooks?: boolean;
  /** Si es true, incluye `hooks.json` (`SessionStart`) en el plugin de Antigravity. */
  agentHooks?: boolean;
  /** Si es true, el hook `pre-push` usa `drift --strict` (falla si hay deriva). */
  strictHooks?: boolean;
  /** Sobrescribe scripts existentes si ya estaban definidos. */
  force?: boolean;
  /** Simula todos los cambios sin escribir en disco. */
  dryRun?: boolean;
}

export interface InitAgentReport {
  projectRoot: string;
  projectName: string;
  harnesses: HarnessId[];
  palaceCommand: string;
  changes: FileChangeEntry[];
}

/**
 * Inserta o actualiza un bloque delimitado por marcadores dentro de un archivo
 * existente sin destruir contenido previo escrito por el equipo.
 */
export function upsertManagedBlock(
  existing: string,
  markerId: string,
  blockContent: string,
  style: "html" | "hash" = "html",
): string {
  const startMarker = style === "html" ? `<!-- ${markerId}:start -->` : `# --- ${markerId}:start ---`;
  const endMarker = style === "html" ? `<!-- ${markerId}:end -->` : `# --- ${markerId}:end ---`;
  const wrapped = `${startMarker}\n${blockContent.trimEnd()}\n${endMarker}`;

  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx).replace(/\s+$/, "");
    const after = existing.slice(endIdx + endMarker.length).replace(/^\s+/, "");
    const parts = [before, wrapped, after].filter((p) => p.length > 0);
    return `${parts.join("\n\n")}\n`;
  }

  const trimmed = existing.trimEnd();
  if (!trimmed) return `${wrapped}\n`;
  return `${trimmed}\n\n${wrapped}\n`;
}

/** Escribe un archivo si su contenido cambió y registra el resultado. */
function writeTextIfChanged(
  absPath: string,
  relPath: string,
  content: string,
  kind: FileChangeEntry["kind"],
  dryRun: boolean,
  mode?: number,
): FileChangeEntry {
  const existed = existsSync(absPath);
  if (existed) {
    const current = readFileSync(absPath, "utf8");
    if (current === content) {
      return { path: relPath, action: "unchanged", kind };
    }
  }

  if (!dryRun) {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, "utf8");
    if (mode !== undefined) {
      try {
        chmodSync(absPath, mode);
      } catch {
        /* ignorar sistemas sin chmod POSIX */
      }
    }
  }

  return { path: relPath, action: existed ? "updated" : "created", kind };
}

/** Detecta los harnesses presentes en el proyecto o máquina. */
export function detectHarnesses(projectRoot: string): HarnessId[] {
  const detected: HarnessId[] = [];

  if (
    existsSync(join(projectRoot, ".agents")) ||
    existsSync(join(projectRoot, ".agent")) ||
    existsSync(join(projectRoot, "GEMINI.md")) ||
    existsSync(join(projectRoot, "AGENTS.md")) ||
    isCommandAvailable("agy")
  ) {
    detected.push("antigravity");
  }

  if (
    existsSync(join(projectRoot, ".cursor")) ||
    existsSync(join(projectRoot, ".cursorrules")) ||
    isCommandAvailable("cursor")
  ) {
    detected.push("cursor");
  }

  if (
    existsSync(join(projectRoot, ".claude")) ||
    existsSync(join(projectRoot, "CLAUDE.md")) ||
    isCommandAvailable("claude")
  ) {
    detected.push("claude");
  }

  if (existsSync(join(projectRoot, ".github"))) {
    detected.push("copilot");
  }

  return detected.length > 0 ? detected : ["antigravity", "cursor", "claude"];
}

/** Genera la directiva de protocolo de memoria activa de Nexo-Palace. */
export function buildAgentProtocolMarkdown(projectName: string): string {
  return [
    `# Memoria Activa del Proyecto (${projectName}) — Nexo-Palace`,
    "",
    "Este repositorio cuenta con el servidor MCP `nexo-palace` (índice híbrido semántico + léxico y grafo de trazabilidad).",
    "Para reducir tokens, evitar lecturas innecesarias y mantener la trazabilidad, sigue este protocolo:",
    "",
    "## 1. Exploración (ANTES de hacer `find`/`grep` masivos o leer múltiples archivos)",
    "- Usa `memory_query({ query, scope?, limit?, pathPrefix? })` con palabras clave o IDs (`RF`, `US`, `EPC`, `ADR`) para localizar especificaciones, código relevante y convenciones (`taste`).",
    "- Usa `memory_trace({ entity, depth? })` sobre los archivos o símbolos clave que vayas a modificar para conocer sus dependencias, tests vinculados y requisitos implementados.",
    "- Una vez localizados los archivos exactos, lee únicamente los fragmentos o rangos necesarios.",
    "",
    "## 2. Registro de Decisiones",
    "- Cuando adoptes un patrón arquitectónico, elijas una biblioteca, cambies un contrato o resuelvas un bug no trivial, invoca `memory_record_decision({ context, decision, tags?, relatedFiles? })`.",
    "",
    "## 3. Sincronización y Cierre",
    "- Tras completar cambios en código o documentación, ejecuta `memory_map({})` (o `nxpl map`) para mantener sincronizados el grafo AST y los embeddings.",
    "- Antes de cerrar la tarea, ejecuta `memory_drift({ dryRun: true })` (o `nxpl drift --dry-run`) para comprobar si algún requisito vinculado requiere revisión.",
    "- Usa `memory_status({})` si necesitas verificar qué proyecto y proveedor están activos.",
    "",
  ].join("\n");
}

/** Genera la regla `.mdc` de Cursor con `alwaysApply: true`. */
export function buildCursorRuleMdc(projectName: string): string {
  return [
    "---",
    `description: Protocolo obligatorio de memoria activa con Nexo-Palace MCP para ${projectName}`,
    "alwaysApply: true",
    "---",
    "",
    buildAgentProtocolMarkdown(projectName).trimEnd(),
    "",
  ].join("\n");
}

/** Genera el `SKILL.md` para descubrimiento progresivo en Antigravity / agentes compatibles. */
function buildAntigravitySkillMd(projectName: string): string {
  return [
    "---",
    "name: nexo-palace",
    "description: >-",
    `  Consult project requirements, architecture, traceability graph, and record decisions for ${projectName} using Nexo-Palace MCP.`,
    "  Use BEFORE mass grep/file reads and AFTER code edits to keep memory synchronized.",
    "---",
    "",
    buildAgentProtocolMarkdown(projectName).trimEnd(),
    "",
  ].join("\n");
}

/**
 * Construye el script `hooks/session-start.cjs` del plugin de Antigravity.
 * Usa un fichero `.cjs` dedicado en lugar de `node -e` inline para evitar
 * problemas de escaping entre `sh -c` (Unix) y `cmd /c` (Windows).
 */
function buildAntigravitySessionHookScript(): string {
  return [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "",
    "let raw = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { raw += chunk; });",
    "process.stdin.on('end', () => {",
    "  let root = process.cwd();",
    "  try {",
    "    const payload = JSON.parse(raw || '{}');",
    "    if (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) {",
    "      root = payload.workspacePaths[0];",
    "    } else if (payload.cwd) {",
    "      root = payload.cwd;",
    "    }",
    "  } catch {",
    "    // Ignorar payload inválido y usar cwd",
    "  }",
    "",
    "  const dbExists = fs.existsSync(path.join(root, '.nexo-palace', 'memory.sqlite3'));",
    "  const msg = dbExists",
    "    ? 'Nexo-Palace MCP activo. Antes de explorar archivos con grep/read_file, usa memory_query(query, scope?, limit?, pathPrefix?) y memory_trace(entity, depth?). Registra decisiones con memory_record_decision(context, decision, tags?, relatedFiles?). Tras editar, sincroniza con memory_map() y revisa impacto con memory_drift(dryRun?).'",
    "    : 'Nexo-Palace plugin activo, pero aún no existe .nexo-palace/memory.sqlite3. Ejecuta memory_map() o `nxpl map` para indexar el proyecto.';",
    "",
    "  process.stdout.write(JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: msg } }] }));",
    "});",
    "",
  ].join("\n");
}

/** Construye el manifiesto `hooks.json` (`SessionStart`) para Antigravity. */
function buildAntigravityHooksJson(): string {
  const hooks = {
    "nexo-palace-session-bootstrap": {
      SessionStart: [
        {
          type: "command",
          command: "node ./hooks/session-start.cjs",
          timeout: 5,
        },
      ],
    },
  };
  return `${JSON.stringify(hooks, null, 2)}\n`;
}

/** Determina el comando apropiado para invocar Nexo-Palace en scripts y git hooks. */
export function resolvePalaceCommand(projectRoot: string): string {
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = readJsonFileSecure(pkgPath) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      if (pkg.name === "@ijonydev/nexo-palace" && existsSync(join(projectRoot, "bin", "nexo-palace.js"))) {
        return "node bin/nexo-palace.js";
      }
      if (pkg.dependencies?.["@ijonydev/nexo-palace"] || pkg.devDependencies?.["@ijonydev/nexo-palace"]) {
        return "nxpl";
      }
    } catch {
      /* fallback a npx */
    }
  }
  return "npx --yes @ijonydev/nexo-palace";
}

/** Añade los scripts `palace:map`, `palace:drift` y `palace:stats` a `package.json`. */
export function ensurePackageScripts(
  projectRoot: string,
  options: { dryRun?: boolean; force?: boolean } = {},
): FileChangeEntry {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return {
      path: "package.json",
      action: "skipped",
      kind: "scripts",
      reason: "No existe package.json en la raíz del proyecto",
    };
  }

  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  const scripts = ((pkg.scripts as Record<string, string> | undefined) ?? {});
  const cmd = resolvePalaceCommand(projectRoot);

  const desired: Record<string, string> = {
    "palace:map": `${cmd} map`,
    "palace:drift": `${cmd} drift --dry-run`,
    "palace:stats": `${cmd} stats`,
  };

  let modified = false;
  for (const [key, value] of Object.entries(desired)) {
    if (!(key in scripts) || (options.force && scripts[key] !== value)) {
      scripts[key] = value;
      modified = true;
    }
  }

  if (!modified) {
    return { path: "package.json", action: "unchanged", kind: "scripts" };
  }

  pkg.scripts = scripts;
  if (!options.dryRun) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }
  return { path: "package.json", action: "updated", kind: "scripts" };
}

/** Instala Git hooks seguros en `.husky/` o `.git/hooks/`. */
export function installGitHooks(
  projectRoot: string,
  options: { dryRun?: boolean; strict?: boolean } = {},
): FileChangeEntry[] {
  const dryRun = options.dryRun ?? false;
  const huskyDir = join(projectRoot, ".husky");
  const gitHooksDir = join(projectRoot, ".git", "hooks");

  let targetDir: string;
  let relPrefix: string;
  if (existsSync(huskyDir)) {
    targetDir = huskyDir;
    relPrefix = ".husky";
  } else if (existsSync(join(projectRoot, ".git"))) {
    targetDir = gitHooksDir;
    relPrefix = ".git/hooks";
  } else {
    return [
      {
        path: ".git/hooks",
        action: "skipped",
        kind: "git-hook",
        reason: "No se detectó repositorio Git (.git ni .husky)",
      },
    ];
  }

  const cmd = resolvePalaceCommand(projectRoot);

  // `post-commit` usa `--best-effort`: actualiza el grafo preservando el proveedor
  // existente y sin bloquear el commit si el proveedor remoto/local está apagado.
  const postCommitBlock = [
    "# Sincroniza la memoria de Nexo-Palace tras el commit sin destruir vectores",
    `${cmd} map --best-effort >/dev/null 2>&1 || true`,
  ].join("\n");

  const driftCmd = options.strict ? `${cmd} drift --strict` : `${cmd} drift --dry-run`;
  const prePushBlock = [
    "# Comprueba si hay requisitos afectados por deriva antes de push",
    driftCmd,
  ].join("\n");

  const entries: Array<{ name: string; block: string }> = [
    { name: "post-commit", block: postCommitBlock },
    { name: "pre-push", block: prePushBlock },
  ];

  const results: FileChangeEntry[] = [];
  for (const { name, block } of entries) {
    const absPath = join(targetDir, name);
    const relPath = `${relPrefix}/${name}`;
    const existing = existsSync(absPath) ? readFileSync(absPath, "utf8") : "#!/bin/sh\n";
    const next = upsertManagedBlock(existing, "nexo-palace", block, "hash");
    results.push(writeTextIfChanged(absPath, relPath, next, "git-hook", dryRun, 0o755));
  }

  return results;
}

/** Obtiene el nombre del proyecto a partir de `nexo-palace.config.json`, `package.json` o la carpeta. */
function inferProjectName(projectRoot: string): string {
  const palaceCfgPath = join(projectRoot, "nexo-palace.config.json");
  if (existsSync(palaceCfgPath)) {
    try {
      const cfg = readJsonFileSecure(palaceCfgPath) as { projectName?: string };
      if (cfg.projectName?.trim()) return cfg.projectName.trim();
    } catch {
      /* fallback */
    }
  }
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = readJsonFileSecure(pkgPath) as { name?: string };
      if (pkg.name?.trim()) return pkg.name.trim();
    } catch {
      /* fallback */
    }
  }
  return basename(projectRoot);
}

/**
 * Inicializa la integración completa de Nexo-Palace para agentes de IA en un repositorio:
 * reglas multi-harness, plugin scoped para Antigravity, scripts npm y Git hooks.
 */
export function initAgentIntegration(
  projectRoot: string,
  options: InitAgentOptions = {},
): InitAgentReport {
  const dryRun = options.dryRun ?? false;
  const projectName = inferProjectName(projectRoot);
  const harnesses =
    options.harnesses && options.harnesses.length > 0
      ? [...new Set(options.harnesses)]
      : detectHarnesses(projectRoot);

  const changes: FileChangeEntry[] = [];
  const protocolMd = buildAgentProtocolMarkdown(projectName);

  for (const harness of harnesses) {
    switch (harness) {
      case "antigravity": {
        // 1. Regla directa de workspace descubierta por Antigravity (.agents/rules/*.md)
        changes.push(
          writeTextIfChanged(
            join(projectRoot, ".agents", "rules", "nexo-palace.md"),
            ".agents/rules/nexo-palace.md",
            protocolMd,
            "rule",
            dryRun,
          ),
        );

        // 2. Plugin scoped de workspace (.agents/plugins/nexo-palace/)
        const pluginDir = join(projectRoot, ".agents", "plugins", "nexo-palace");
        const pluginRel = ".agents/plugins/nexo-palace";

        changes.push(
          writeTextIfChanged(
            join(pluginDir, "plugin.json"),
            `${pluginRel}/plugin.json`,
            `${JSON.stringify(
              {
                name: "nexo-palace",
                description: `Memoria activa de proyecto e índice híbrido para ${projectName}`,
                version: "0.1.3",
              },
              null,
              2,
            )}\n`,
            "plugin",
            dryRun,
          ),
        );

        changes.push(
          writeTextIfChanged(
            join(pluginDir, "mcp_config.json"),
            `${pluginRel}/mcp_config.json`,
            `${JSON.stringify({ mcpServers: { "nexo-palace": NEXO_PALACE_MCP_SERVER_CONFIG } }, null, 2)}\n`,
            "plugin",
            dryRun,
          ),
        );

        changes.push(
          writeTextIfChanged(
            join(pluginDir, "rules", "AGENTS.md"),
            `${pluginRel}/rules/AGENTS.md`,
            protocolMd,
            "plugin",
            dryRun,
          ),
        );

        changes.push(
          writeTextIfChanged(
            join(pluginDir, "skills", "nexo-palace", "SKILL.md"),
            `${pluginRel}/skills/nexo-palace/SKILL.md`,
            buildAntigravitySkillMd(projectName),
            "plugin",
            dryRun,
          ),
        );

        if (options.agentHooks !== false) {
          changes.push(
            writeTextIfChanged(
              join(pluginDir, "hooks", "session-start.cjs"),
              `${pluginRel}/hooks/session-start.cjs`,
              buildAntigravitySessionHookScript(),
              "plugin",
              dryRun,
            ),
          );
          changes.push(
            writeTextIfChanged(
              join(pluginDir, "hooks.json"),
              `${pluginRel}/hooks.json`,
              buildAntigravityHooksJson(),
              "plugin",
              dryRun,
            ),
          );
        }
        break;
      }

      case "cursor": {
        changes.push(
          writeTextIfChanged(
            join(projectRoot, ".cursor", "rules", "nexo-palace.mdc"),
            ".cursor/rules/nexo-palace.mdc",
            buildCursorRuleMdc(projectName),
            "rule",
            dryRun,
          ),
        );
        break;
      }

      case "claude": {
        const claudePath = join(projectRoot, "CLAUDE.md");
        const existing = existsSync(claudePath) ? readFileSync(claudePath, "utf8") : "";
        const next = upsertManagedBlock(existing, "nexo-palace", protocolMd, "html");
        changes.push(writeTextIfChanged(claudePath, "CLAUDE.md", next, "rule", dryRun));
        break;
      }

      case "copilot": {
        const copilotPath = join(projectRoot, ".github", "copilot-instructions.md");
        const existing = existsSync(copilotPath) ? readFileSync(copilotPath, "utf8") : "";
        const next = upsertManagedBlock(existing, "nexo-palace", protocolMd, "html");
        changes.push(
          writeTextIfChanged(copilotPath, ".github/copilot-instructions.md", next, "rule", dryRun),
        );
        break;
      }
    }
  }

  if (options.scripts !== false) {
    changes.push(
      ensurePackageScripts(projectRoot, {
        dryRun,
        force: options.force,
      }),
    );
  }

  if (options.gitHooks !== false) {
    changes.push(...installGitHooks(projectRoot, { dryRun, strict: options.strictHooks }));
  }

  return {
    projectRoot,
    projectName,
    harnesses,
    palaceCommand: resolvePalaceCommand(projectRoot),
    changes,
  };
}
