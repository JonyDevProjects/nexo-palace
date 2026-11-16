# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2026-11-16

### Added
- **Polyglot Code Extraction & Modular Registry (`src/extractors/`):**
  - Introduced `ExtractorRegistry` and `LanguageExtractor` contract, completely decoupling AST processing from `ts-morph` and the core pipeline.
  - Added **`PythonExtractor`** powered by `tree-sitter` and `tree-sitter-python` for extracting Python functions, classes, methods, docstrings, `@implements` directives and intra-package import graphs.
  - Added **`HtmlExtractor`** for Angular templates and web components (`.html`, `.htm`), extracting custom tags (`<app-*>`, `<p-*>`), template references (`#form`), requirements and companion `.ts`/stylesheet links.
  - Added **`CssExtractor`** for stylesheets (`.css`, `.scss`, `.sass`, `.less`), extracting class selectors, mixins (`@mixin`), `@keyframes`, `@use`/`@import` rules and companion `.ts` component links.
  - Added **`SqlExtractor`** for relational schemas and migrations (`.sql`), extracting `CREATE TABLE`, `CREATE VIEW`, `CREATE FUNCTION/PROCEDURE`, `CREATE INDEX`, foreign key references and requirements.
  - Enhanced **`TsExtractor`** to support `.mjs`, `.cjs`, `.mts`, `.cts` and automatic resolution of Angular `@Component` metadata (`templateUrl` and `styleUrls`/`styleUrl`) into the `depends_on` dependency graph.
- **Deep Hierarchical Monorepo Autodiscovery (`src/config.ts`):**
  - Enhanced `detectCodeDirs` with 2-level traversal for monorepos (`apps/*/src`, `packages/*/src`, `modules/*/src`, `tools`, `shared`, `utils`, `db`) discovering complex project structures without manual configuration.
  - Expanded `codeExtensions` defaults to include `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.py`, `.html`, `.css`, `.scss`, `.less`, `.sql`.
  - Added `.angular`, `.nx`, and `.tmp-harvest` to default `ignoreDirs`.
- **Shortest Path Tool & Query in Knowledge Graph (T2 - `src/trace.ts`, `src/server.ts`, `src/cli.ts`):**
  - Implemented `findPath` using breadth-first search (BFS) with cycle detection via SQLite recursive common table expressions (`WITH RECURSIVE`).
  - Added **`memory_path`** tool to MCP tool surface (`from`, `to`, `maxHops`).
  - Added `nexo-palace path <from> <to>` CLI command.
- **Self-Hosting Workspace Plugin Resilience (`src/installer.ts`, `src/config.ts`):**
  - Differentiated development repo from consumer npm packages (`isSelfHostingRepo`) to prevent npx collision in local workspaces.
  - Fixed `agy mcp add` flag syntax with `--` argument separator.
  - Added `findFallbackProjectRoot` resolving upward project root markers.

---

## [0.1.4] - 2026-11-16

### Added
- **MCP Roots Dynamic Workspace Support (`src/server.ts`):**
  - Implemented dynamic workspace binding via MCP Roots (`server.server.listRoots()`) on initialization.
  - Added reactive subscription to `RootsListChangedNotificationSchema` to rebind project root in hot-reload scenarios without restarting the MCP server.
  - Added `pickWorkspaceRoot` prioritizing directories with existing `nexo-palace.config.json` or `.nexo-palace/`.
- **Full MCP Operational Lifecycle Surface (`src/server.ts`):**
  - Added **`memory_map`** tool allowing AI agents to trigger non-destructive reindexing after code edits directly through MCP.
  - Added **`memory_drift`** tool enabling architectural drift checks across changed files.
  - Expanded default MCP tool surface to 6 tools (`memory_query`, `memory_status`, `memory_trace`, `memory_record_decision`, `memory_map`, `memory_drift`), while preserving `PALACE_TOOLS=phase1` constraint mode.
  - Enriched `memory_status` payload with `projectName`, `projectRoot`, `configFile`, `dbPath`, and configuration health warnings.
- **Agent Integration & Multi-Harness Bootstrapper (`src/agent-integration.ts`, `src/cli.ts`):**
  - Added `init-agent` (alias `init-rules`) CLI command with automated harness detection (`antigravity`, `cursor`, `claude`, `copilot`).
  - Added idempotent rule generator supporting non-destructive managed blocks in `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`.
  - Added `.cursor/rules/nexo-palace.mdc` generator with `alwaysApply: true`.
  - Added Antigravity workspace plugin generator (`.agents/plugins/nexo-palace/`) bundled with manifest, tools, rules, skills, and cross-platform `SessionStart` hook (`hooks/session-start.cjs`) to mitigate lazy-loading friction.
  - Added safe Git hook generator supporting `.husky/` and `.git/hooks/` with `map --best-effort` on `post-commit` and `drift --dry-run` / `drift --strict` on `pre-push`.
  - Added automatic injection of `palace:map`, `palace:drift`, and `palace:stats` scripts to `package.json`.
- **Unified Mapping & Best-Effort Mode (`src/map.ts`):**
  - Extracted unified mapping logic with `--best-effort` support to prevent accidental vector table destruction when remote/local embedding providers are temporarily unavailable.
- **Architecture & DX Findings Document:**
  - Published comprehensive findings and root-cause analysis report in [docs/mcp-agent-adoption-findings.md](docs/mcp-agent-adoption-findings.md).

### Fixed
- **CLI Serve Stdio Lifecycle Termination (`src/cli.ts`):**
  - Resolved premature exit bug where `cli.ts serve` terminated with code 0 immediately after server instantiation. Process now properly blocks on `stdin` and `server.server.onclose`.
- **Legacy Antigravity Config Hardcoded Root Sanitization (`src/installer.ts`):**
  - Added automatic detection and sanitization of static `NEXO_PALACE_ROOT` entries in legacy `~/.gemini/antigravity/mcp_config.json`.
- **Drift Detection Dry-Run Mutability (`src/drift.ts`):**
  - Ensured `drift` with `mark: false` / `dryRun: true` does not mutate `drift_events` table in SQLite.

---

## [0.1.3] - 2026-11-15

### Fixed
- **NPM Distribution & Node.js Type Stripping Limitation:**
  - Resolved `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` caused by Node.js prohibiting `--experimental-strip-types` on files under `node_modules`.
  - Added dedicated TypeScript compilation (`tsconfig.build.json`) outputting pure JavaScript ESM to `dist/` with full `.d.ts` declaration files.
  - Added cross-platform asset copying (`scripts/copy-assets.js`) to bundle `src/schema.sql` into `dist/schema.sql`.
  - Updated launcher `bin/nexo-palace.js` to prioritize compiled `dist/cli.js` when running from NPM/npx, with seamless fallback to `src/cli.ts` in local development environments.
  - Updated `postinstall` script to safely execute compiled `dist/installer.js` when available.

### Changed
- **NPM Package Bundle:** Added `dist/` to `files` in `package.json` and introduced `build`, `prepare`, and `prepublishOnly` lifecycle hooks.
- **Workspace Plugin MCP Config:** Updated `.agents/plugins/nexo-palace/mcp_config.json` to directly invoke local development server via Node in the authoring repository.

---

## [0.1.2] - 2026-11-15

### Added
- **Automatic MCP Client Discovery & Configuration (`src/installer.ts`):**
  - Interactive setup prompt offering zero-config auto-registration for installed AI clients.
  - Automatic detection and atomic configuration for **Claude Desktop** (cross-platform config paths), **Cursor** (global `~/.cursor/mcp.json` and project-level `.cursor/mcp.json`), **Google Antigravity** (`agy mcp add` CLI integration and plugin sync), and **VS Code** (`.vscode/mcp.json`).
  - Standardized universal server command `npx -y @ijonydev/nexo-palace serve` and `nxpl serve` eliminating broken absolute or relative local development file paths.
- **Interactive Visual Architecture Suite ([docs/architecture/](docs/architecture/)):**
  - Comprehensive architectural documentation compiled into standalone interactive HTML diagrams with [Archify](https://github.com/tt-a1i/archify):
    - Global system architecture (`nexo-palace-architecture.html`).
    - Decoupled hybrid search and lexical fallback workflow (`hybrid-search-fallback.html`).
    - SQLite memory relational and virtual table ERD (`memory-database.html`).
    - Central architecture guide ([docs/architecture/README.md](docs/architecture/README.md)) with embedded Mermaid diagrams.
- **CI/CD Pipeline (`.github/workflows/ci.yml`):** Automated checks for `main` and `develop` running TypeScript typecheck (`tsc --noEmit`), Vitest suite (`vitest run`), and NPM packaging validation (`npm pack --dry-run`) on Node.js 22.
- **Unit Test Coverage Expansion:**
  - `tests/unit/installer.test.ts`: Added 7 new unit tests for atomic MCP configuration injection and client discovery.
  - `tests/unit/query.test.ts`: Added tests for Reciprocal Rank Fusion (RRF), BM25 lexical mode, mock vector search, and path/scope filters.
  - `tests/unit/trace.test.ts`: Added tests for graph traversal, entity resolution by file/symbol, candidate detection, and relationship hops (`tests`, `requirements`, `imports`).
  - Test suite expanded to 45 unit tests (100% passing).
- **Internationalization (i18n):**
  - Added full English documentation in `README.en.md`.
  - Added bilingual language switcher (`[English](README.en.md) | [Español](README.md)`) to both README files.
- **Community & Collaboration (`CONTRIBUTING.md`):** Complete guide covering Gitflow development workflow, Conventional Commits, code standards, and local verification commands.
- **Gitflow Architecture:** Established protected `main` and active integration `develop` branches with automated worktree orchestration via Herdr.

### Changed
- **Workspace Plugin MCP Config:** Updated `.agents/plugins/nexo-palace/mcp_config.json` to use standard `npx -y @ijonydev/nexo-palace serve` instead of local development paths.
- **Documentation:** Updated `README.md` and `README.en.md` with explicit MCP client configuration examples for Claude Desktop, Cursor, VS Code, and Google Antigravity.

---

## [0.1.1] - 2026-11-14

### Added
- **Interactive Terminal UI (TUI):**
  - Native keyboard-navigable menu (`↑`/`↓` or `j`/`k`, `Enter`/`Space`) in `src/tui.ts` using zero external dependencies.
  - Real-time status detection for local embedding services (Ollama, LiteRT).
  - Visual animated progress bar (`ProgressBar`) providing real-time feedback during document ingestion and AST code extraction.
  - Interactive post-installation prompt to map the project immediately.
- **Bilingual Requirement Normalization:**
  - Automatic cross-normalization between Spanish and English agile/IEEE conventions (`FR` ↔ `RF`, `NFR` ↔ `RNF`, `HU`/`STORY` ↔ `US`, `UC` ↔ `CU`, `EPIC` ↔ `EPC`, `AC` ↔ `CA`, `TC` ↔ `CP`).
- **Project Auto-Discovery:**
  - Automatic detection of standard source directories (`src`, `lib`, `app`, `components`, `tests`) in root and first-level subdirectories (e.g. `viz-app/src`, monorepos).
  - Auto-discovery of root-level Markdown documentation without manual configuration.
- **CLI Alias:** Added short binary alias `nxpl` alongside `nexo-palace`.

### Changed
- **CLI Concept & Naming:** Rebranded identity around *The Dream Architect* (*El Arquitecto del Sueño*), establishing `map` as the primary command (keeping `index` as a backward-compatible alias).
- **Documentation:** Updated README with detailed usage examples, installation requirements, and sample agent prompts.

### Security
- **POSIX File Permissions:** Hardened local database and configuration security with `0700` for `.nexo-palace/` directory and `0600` for `memory.sqlite3` and `.env`.
- **Atomic File Operations:** Implemented `writeJsonFileSecure` with `.tmp` writing, `.bak` backup generation, and atomic replacement to prevent file corruption.
- **Strict JSON Parsing:** Enforced strict JSON validation in configuration loaders to avoid silent state wiping.
- **Credential Protection:** Moved Google Gemini API key passing from URL query parameters to the standard `x-goog-api-key` HTTP header to prevent exposure in proxy/network logs.

---

## [0.1.0] - 2026-11-13

### Added
- **Initial Release:** First public release under `@ijonydev/nexo-palace`.
- **Hybrid Retrieval Engine:** Combines FTS5/BM25 full-text lexical search, exact identifier matching, and vector similarity search via `sqlite-vec` merged through Reciprocal Rank Fusion (RRF).
- **Traceability Knowledge Graph:** Bidirectional graph linking requirements, user stories, architecture docs, source code AST, unit tests, and design decisions.
- **Model Context Protocol (MCP) Server:** Exposes memory tools for AI agents (`memory_query`, `memory_trace`, `memory_status`, `memory_record_decision`).
- **Interactive Zero-Config Installer:** CLI setup wizard supporting Gemini Embeddings (`text-embedding-004`, `gemini-embedding-exp-03-07`), LiteRT local models, and Ollama.
- **Code Drift Detection:** Identifies unindexed files, broken links, and orphans between requirements and implementation.
