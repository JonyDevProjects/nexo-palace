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
### 2026-11-15 — mcp, roots, agent-integration, hooks, cli
* **Contexto:** Los agentes ignoraban el MCP nexo-palace por configuraciones con NEXO_PALACE_ROOT fijo, bug de salida prematura en cli.ts serve, friccion de carga Lazy y falta de reglas/hooks/herramientas de cierre en MCP
* **Decisión:** Se implemento soporte nativo de MCP Roots (roots/list y roots/list_changed), fix de ciclo de vida en cli.ts serve, herramientas MCP memory_map y memory_drift, modulo agent-integration con comando init-agent para reglas multi-harness (.agents, Cursor, Claude, Copilot), plugin Antigravity con SessionStart hook y Git hooks seguros con map --best-effort
* **Archivos relacionados:** src/server.ts, src/cli.ts, src/map.ts, src/agent-integration.ts, src/installer.ts, src/drift.ts
* **Episodio:** `decision:2026-11-15T23-27-05-604Z`
### 2026-11-16 — mcp, self-hosting, npm, antigravity, config
* **Contexto:** El plugin del workspace en el repo fuente usaba npx y colisionaba con el paquete local (exit 127), agy mcp add recibia flags inexistentes --arg=, y config.ts sin nexo-palace.config.json caia al cwd del plugin
* **Decisión:** Se diferencio self-hosting via isSelfHostingRepo/resolveMcpServerConfig usando node directo sobre src/cli.ts serve en el repo fuente manteniendo npx zero-config en NPM; se corrigio agy mcp add con -- en installer y docs; se anadio fallback de raiz ascendente (.nexo-palace/.agents/.git) en config.ts; y se anadio salvaguarda CLI en hooks/reglas si memory_* no esta en herramientas MCP activas
* **Archivos relacionados:** src/installer.ts, src/agent-integration.ts, src/config.ts, README.md, README.en.md, docs/mcp-npm-integration-finding.md
* **Episodio:** `decision:2026-11-16T00-46-17-926Z`
### 2026-11-16 — trazabilidad, grafo, mcp, caminos, t2
* **Contexto:** Implementacion de T2 del roadmap v0.2.0: busqueda del camino mas corto entre entidades en el grafo de trazabilidad.
* **Decisión:** Se implemento la funcion findPath en src/trace.ts empleando una consulta recursiva (WITH RECURSIVE) sobre SQLite que explora aristas bidireccionales con deteccion de ciclos en amplitud (BFS). Se expuso la herramienta MCP memory_path en src/server.ts en la superficie por defecto y el comando CLI nexo-palace path <from> <to> en src/cli.ts.
* **Archivos relacionados:** src/trace.ts, src/server.ts, src/cli.ts, tests/unit/trace.test.ts, tests/unit/mcp-server.test.ts
* **Episodio:** `decision:2026-11-16T01-18-55-409Z`
