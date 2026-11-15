# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **CI/CD Pipeline (`.github/workflows/ci.yml`):** Automated checks for `main` and `develop` running TypeScript typecheck (`tsc --noEmit`), Vitest suite (`vitest run`), and NPM packaging validation (`npm pack --dry-run`) on Node.js 22.
- **Unit Test Coverage for Engine:**
  - `tests/unit/query.test.ts`: Added tests for Reciprocal Rank Fusion (RRF), BM25 lexical mode, mock vector search, and path/scope filters.
  - `tests/unit/trace.test.ts`: Added tests for graph traversal, entity resolution by file/symbol, candidate detection, and relationship hops (`tests`, `requirements`, `imports`).
  - Total test count expanded from 24 to 38 unit tests (100% passing).
- **Internationalization (i18n):**
  - Added full English documentation in `README.en.md`.
  - Added bilingual language switcher (`[English](README.en.md) | [Español](README.md)`) to both README files.
- **Community & Collaboration (`CONTRIBUTING.md`):** Complete guide covering Gitflow development workflow, Conventional Commits, code standards, and local verification commands.
- **Gitflow Architecture:** Established protected `main` and active integration `develop` branches with automated worktree orchestration via Herdr.

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
