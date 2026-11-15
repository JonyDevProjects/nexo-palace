# Decisiones

> Registro de decisiones de arquitectura tomadas durante la ejecución de las skills EGM.
> Este fichero lo mantiene el Nexo-Palace Engine a través de `memory_record_decision`.


### 2026-11-14 — mcp, agy, antigravity, architecture, workspace-plugin
* **Contexto:** Configuración e integración de Nexo-Palace como servidor MCP scoped por workspace para el harness agy (Google Antigravity), evitando colisiones globales en ~/.gemini/config/
* **Decisión:** Se estructuró el plugin de workspace en .agents/plugins/nexo-palace/ con plugin.json, mcp_config.json ejecutando 'node --experimental-strip-types src/server.ts' y directivas de memoria activa en rules/AGENTS.md para que el agente consulte memoria antes de refactorizar.
* **Archivos relacionados:** .agents/plugins/nexo-palace/plugin.json, .agents/plugins/nexo-palace/mcp_config.json, .agents/plugins/nexo-palace/rules/AGENTS.md
* **Episodio:** `decision:2026-11-14T14-50-07-364Z`
### 2026-11-15 — mcp, npm, dx, installer, architecture
* **Contexto:** Integracion de MCP para usuarios de NPM en clientes como Claude Desktop, Cursor y Antigravity
* **Decisión:** Los instaladores y asistentes de setup deben autoconfigurar el servidor MCP utilizando el binario empaquetado ('npx @ijonydev/nexo-palace serve') en lugar de rutas absolutas locales a 'src/server.ts', garantizando portabilidad zero-config para usuarios finales
* **Archivos relacionados:** src/installer.ts, docs/decisions.md
* **Episodio:** `decision:2026-11-15T08-05-02-376Z`
### 2026-11-15 — mcp, antigravity, plugin, dx
* **Contexto:** Configuración de MCP en workspace plugin para Antigravity
* **Decisión:** Restaurar invocación directa con Node y --experimental-strip-types en src/server.ts para evitar colisión de npx en el propio repo de desarrollo
* **Archivos relacionados:** .agents/plugins/nexo-palace/mcp_config.json
* **Episodio:** `decision:2026-11-15T10-41-37-531Z`
### 2026-11-15 — npm, distribution, build, typescript, node_modules
* **Contexto:** Distribución NPM v0.1.3 y limitación de Node.js con type stripping en node_modules
* **Decisión:** Implementar compilación previa a dist/ mediante tsconfig.build.json, script de copia de schema.sql, scripts build/prepare/prepublishOnly en package.json y lanzador bin/nexo-palace.js híbrido con fallback a TypeScript en desarrollo
* **Archivos relacionados:** bin/nexo-palace.js, package.json, tsconfig.build.json, scripts/copy-assets.js
* **Episodio:** `decision:2026-11-15T10-49-06-232Z`
