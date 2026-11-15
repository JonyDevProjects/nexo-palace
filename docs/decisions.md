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
