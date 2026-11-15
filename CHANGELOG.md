# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
