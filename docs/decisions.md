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
### 2026-11-16 — arquitectura, poliglota, tree-sitter, python, extractores, ast
* **Contexto:** Ampliación de Nexo-Palace hacia análisis políglota (v0.3.0) para soportar extracción de código y dependencias más allá de TypeScript/JavaScript.
* **Decisión:** Se implementó una arquitectura extensible de extractores (LanguageExtractor y ExtractorRegistry) que desacopla ts-morph del pipeline central en src/extract-code.ts, e integra tree-sitter y tree-sitter-python para parsear archivos .py extrayendo funciones, clases, docstrings, comentarios contiguos, @implements y dependencias de imports relativos/absolutos. Se añadió .py a codeExtensions por defecto.
* **Archivos relacionados:** src/extract-code.ts, src/extractors/types.ts, src/extractors/registry.ts, src/extractors/ts-extractor.ts, src/extractors/python-extractor.ts, src/config.ts
* **Episodio:** `decision:2026-11-16T01-48-53-098Z`
### 2026-11-16 — poliglota, angular, nestjs, monorepo, html, css, scss, sql, nx
* **Contexto:** Soporte integral para los lenguajes y arquitectura del stack de proyectos fullstack y monorrepos Nx (como tfg-edwin: Angular, NestJS, Nx tools, plantillas HTML, estilos SCSS/CSS/Less y bases de datos SQL).
* **Decisión:** Se implementaron extractores dedicados para HTML (HtmlExtractor con soporte de etiquetas de componentes, referencias de plantilla e imports companion), estilos (CssExtractor con clases, mixins, @use/@import y companion) y bases de datos relacionales (SqlExtractor con tablas, vistas, funciones, índices y foreign keys). Se amplió TsExtractor para soportar módulos .mjs, .cjs, .mts, .cts y resolución automática de dependencias Angular (@Component con templateUrl y styleUrls). Se dotó a detectCodeDirs de autodescubrimiento jerárquico de monorrepos (apps/*/src, packages/*/src, tools, shared, utils, db), y se añadieron .html, .css, .scss, .less, .sql, .mjs, .cjs a codeExtensions y .angular, .nx, .tmp-harvest a ignoreDirs.
* **Archivos relacionados:** src/extractors/html-extractor.ts, src/extractors/css-extractor.ts, src/extractors/sql-extractor.ts, src/extractors/ts-extractor.ts, src/extractors/registry.ts, src/config.ts, src/extract-code.ts, tests/unit/polyglot-extractors.test.ts
* **Episodio:** `decision:2026-11-16T02-08-30-000Z`
### 2026-11-16 — roadmap, calidad, prompts, code-smells, ast
* **Contexto:** Añadir tarea de investigacion al roadmap de Nexo-Palace sobre deteccion de malas practicas como hardcodear prompts en codigo.
* **Decisión:** Se anadio la seccion 4.7 en docs/roadmap-next-steps.md especificando analisis AST de literales de strings, clasificacion lexica y semantica de prompts, trazabilidad de code smells en el grafo y herramientas de refactor hacia Markdown/JSON externos.
* **Archivos relacionados:** docs/roadmap-next-steps.md
* **Episodio:** `decision:2026-11-16T23-58-49-383Z`
### 2026-11-17 — roadmap, optimizacion, tokens, harnesses, mcp, dx
* **Contexto:** Inclusion en el roadmap de la tarea 4.8 para optimizar el coste de tokens y la calidad de respuestas de agentes mediante mejor direccionamiento de tools MCP y payloads compactos.
* **Decisión:** Se anadio la seccion 4.8 a docs/roadmap-next-steps.md detallando: enrutamiento por intencion en directivas y SessionStart hook, desduplicacion de decisiones en parseAsDecisions, enriquecimiento operativo de memory_status con Git y ultimas decisiones, y compactacion de payloads en memory_trace y memory_query.
* **Archivos relacionados:** docs/roadmap-next-steps.md, src/agent-integration.ts, src/server.ts, src/trace.ts, src/query.ts, src/ingest-docs.ts
* **Episodio:** `decision:2026-11-17T10-06-36-181Z`
### 2026-11-17 — bugfix, mcp, antigravity, roots, sqlite
* **Contexto:** Error ENOENT mkdir '/.nexo-palace' durante initialize en Antigravity IDE al lanzar el servidor MCP con process.cwd()='/'.
* **Decisión:** Se difirio la apertura de SQLite y del proveedor de embeddings en src/server.ts hasta la primera invocacion de herramienta tras completar el handshake MCP y consultar roots/list. Ademas se añadieron isSystemRoot e isUnsafeWorkspaceRoot en src/config.ts para omitir detectCodeDirs en '/' y devolver warning/error controlado si el cliente no reporta roots validos.
* **Archivos relacionados:** src/server.ts, src/config.ts, tests/unit/mcp-server.test.ts, tests/unit/config.test.ts, src/test-mcp.ts
* **Episodio:** `decision:2026-11-17T13-14-28-102Z`
