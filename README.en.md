# Nexo-Palace

[English](README.en.md) | [Español](README.md) · [Contributing Guide](CONTRIBUTING.md)

[![npm version](https://img.shields.io/npm/v/@ijonydev/nexo-palace.svg)](https://www.npmjs.com/package/@ijonydev/nexo-palace)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Active project memory for AI agents.

Transforms documentation, source code, and project conventions into a **hybrid index** (semantic vector search + BM25 lexical) and a **traceability graph**. It exposes this memory through a CLI and an **MCP Server** (`@modelcontextprotocol/sdk`) so that any AI agent can query institutional knowledge directly instead of linearly rereading repository files.

Everything is local: stored in a single SQLite file, with zero mandatory cloud dependencies.

```
┌──────────────┐   index    ┌──────────────┐   query    ┌──────────────┐
│  docs/       │ ─────────► │  SQLite      │ ◄───────── │  AI agents   │
│  source code │            │  FTS5 + vec  │            │  MCP / CLI   │
│  taste/      │            │  + graph     │            └──────────────┘
└──────────────┘            └──────────────┘
```

---

## The Problem & The Solution

- **The Problem:** As repositories grow, AI agents face severe context degradation, hallucinate about non-existent APIs, repeat previously discarded architectural decisions, and fail to track relationships between product requirements, code, tests, and conventions. Rereading entire directories on every prompt exhausts token limits and loses precision.
- **The Solution:** Nexo-Palace provides persistent, deterministic active memory. By combining AST extraction (`ts-morph`), bidirectional requirement linking, BM25 full-text indexing (FTS5), vector embeddings (`sqlite-vec`), and Reciprocal Rank Fusion (RRF), agents can retrieve high-precision subgraphs and semantic context in milliseconds.

---

## Key Features

- **Hybrid Search with Reciprocal Rank Fusion (RRF):** Combines FTS5 BM25 text relevance, exact keyword/identifier matches, and vector similarity (`sqlite-vec`).
- **Observable Traceability Graph:** Maps real relationships between product requirements, implementation symbols, test suites, ADRs/decisions, and conventions (`implements`, `tests`, `depends_on`, `references`, `governed_by`).
- **Dual Interface:**
  - **CLI:** Command-line utilities (`nexo-palace` / `nxpl`) to map, query, trace, detect drift, and record decisions.
  - **MCP Server:** Standardized Model Context Protocol server over `stdio` for seamless integration with Claude Desktop, Antigravity, Cursor, Windsurf, CommandCode, and others.
- **Interactive Zero-Config Installer:** Automatically discovers repo topology (docs, code directories, conventions) and local inference services (`litert`, `ollama`).
- **Bilingual Requirement Normalization:** Automatically cross-normalizes requirement identifiers between Spanish and English (`RF` ↔ `FR`, `RNF` ↔ `NFR`, `HU` ↔ `US`, `CU` ↔ `UC`, `EPC` ↔ `EPIC`, `TC` ↔ `CP`, `AC` ↔ `CA`).

---

## Prerequisites

Before installing Nexo-Palace, ensure your environment meets the following requirements:

- **Node.js `>= 22.6.0`** (required for native TypeScript `--experimental-strip-types` and modern SQLite support).
- **npm `>= 10.0.0`** (or equivalent pnpm / yarn).
- **Embedding Provider** (optional, recommended for semantic vector retrieval):
  - **Option A (Cloud / Free Tier):** Google AI Studio API key (`GEMINI_API_KEY`). Requires no local services and consumes no GPU/RAM.
  - **Option B (Local / Private):** Python `>= 3.9` with `mlc-ai-litert`, or **Ollama** running `nomic-embed-text`.
  - **Option C (Zero Dependencies / Offline):** Pure lexical BM25 search without external providers.

---

## Installation

### Interactive Quick Setup (Recommended)

In the root of any repository you want to map:

```bash
npx @ijonydev/nexo-palace setup
```

The interactive wizard:
1. Detects active local services (`litert`, `ollama`).
2. Lets you select a provider with arrow keys (`↑`/`↓`) and confirm with `Space` or `Enter`.
3. Saves a protected configuration (`0600`) and offers to **map the project immediately**.

---

### Project Dependency Installation

```bash
npm install --save-dev @ijonydev/nexo-palace
```

Available executables after installation: **`nxpl`** (fast alias) and **`nexo-palace`**.

---

## Configuration by Use Case

### Case 1: Cloud Embeddings with Gemini (No local services needed)
Ideal for maximum speed and top-tier semantic accuracy without running heavy local inference services:
1. Obtain a free API key at [aistudio.google.com](https://aistudio.google.com/).
2. In your project root, create or edit `nexo-palace.config.json`:
   ```json
   {
     "PALACE_EMBED_PROVIDER": "gemini"
   }
   ```
3. Add your key to `.env`:
   ```bash
   GEMINI_API_KEY="AIzaSy..."
   ```
4. Map the repository:
   ```bash
   npx nxpl map
   ```

### Case 2: 100% Local and Private Environments (Ollama or LiteRT)
- **With Ollama:**
  ```bash
  ollama pull nomic-embed-text
  npx nxpl map --provider ollama
  ```
- **With LiteRT:**
  ```bash
  pip install mlc-ai-litert
  python -m litert.serve --port 11435
  npx nxpl map --provider litert
  ```

### Case 3: Offline Mode (No network, no external engines)
Uses native SQLite BM25 lexical search (FTS5). Zero internet connection or external services required:
```bash
npx nxpl map --provider offline
```

---

## Prompting Your AI Assistant to Install and Configure Nexo-Palace

If you are using Claude Code, Cursor, Windsurf, Antigravity, or CommandCode, you can copy and paste these prompts:

### General Prompt (If using local LiteRT or Ollama)
> "Install `@ijonydev/nexo-palace` as a dev dependency (`npm install -D @ijonydev/nexo-palace`). Configure `nexo-palace.config.json` with `"PALACE_EMBED_PROVIDER": "litert"` (or `"ollama"`), run `npx nxpl map` to index the repository, and register the MCP server using command `npx` with args `["--no-install", "nxpl", "serve"]`."

### Gemini API Prompt (Without installing local inference servers)
> "Install `@ijonydev/nexo-palace` as a dev dependency (`npm install -D @ijonydev/nexo-palace`), set `"PALACE_EMBED_PROVIDER": "gemini"` in `nexo-palace.config.json`, and ensure `GEMINI_API_KEY` is defined in `.env` (ask me for the key if not set). Then run `npx nxpl map` and register the MCP server (`nxpl serve`)."

---

## Project Configuration

Nexo-Palace is designed for **zero mandatory configuration**. When running `npx nxpl map`, **The Dream Architect** automatically discovers your project layout:
- **Documentation:** Automatically scans Markdown (`.md`) files from the repository root (`["."]`), respecting standard ignored folders (`ignoreDirs`).
- **Code:** Detects common source folders (`src`, `lib`, `app`, `components`, `tests`, etc.) in the root and in **first-level subprojects** (e.g., `viz-app/src`, `packages/core/src`), with fallback to `["."]`.
- **Conventions & Team Taste (`taste`):** Automatically locates existing architecture and convention directories like `.commandcode/taste`, `docs/adr`, `docs/adrs`, or `docs/decisions`.
- **Multilingual Requirements:** Recognizes standard prefixes across Spanish and English (`RF`, `RNF`, `FR`, `NFR`, `HU`, `US`, `CU`, `UC`, `EPC`, `EPIC`, `REQ`, `TASK`, `TSK`, `ADR`, `RFC`, `SPEC`, `TC`, `CP`, `AC`, `CA`, `BUG`, `FIX`, `WP`) with automatic **cross-normalization** (e.g., `FR-001` → `RF-001`, `HU-101` → `US-101`, `UC-10` → `CU-10`).

If your project requires custom directories, exclusions, or custom prefixes, create a `nexo-palace.config.json` file in your root:

```json
{
  "projectName": "my-project",

  "docs": ["."],
  "tasteDirs": [".commandcode/taste", "docs/adr"],

  "codeDirs": ["src", "viz-app/src"],
  "codeExtensions": [".ts", ".tsx", ".js", ".jsx"],

  "requirementPrefixes": ["RF", "RNF", "HU", "CU", "EPC", "US", "ADR", "REQ", "TASK"],

  "decisionsFile": ".nexo-palace/decisions.md",
  "dbPath": ".nexo-palace/memory.sqlite3",

  "ignoreDirs": ["node_modules", ".git", ".next", "dist", "build", "coverage"]
}
```

| Key | Description | Default (Auto-discovered) |
| :--- | :--- | :--- |
| `projectName` | Project name displayed in MCP descriptions. | Root directory name. |
| `docs` | Directories or specific Markdown files to index. | `["."]` (all repo markdown). |
| `tasteDirs` | Directories containing conventions and architecture decisions (`taste`). | Autodetects `.commandcode/taste`, `docs/adr*`, `docs/decisions`. |
| `codeDirs` | Source code directories analyzed by the AST extractor (`ts-morph`). | Autodetects `src/`, `lib/`, etc., in root and subfolders. |
| `codeExtensions` | File extensions indexed into the code graph. | `[".ts", ".tsx", ".js", ".jsx"]` |
| `requirementPrefixes` | Recognized requirement prefixes (`RF-01`, `US-101`…). | 24 standard ES/EN prefixes with cross-normalization. |
| `decisionsFile` | Markdown file where recorded decisions are appended. | `docs/decisions.md` (or `.nexo-palace/decisions.md`). |
| `dbPath` | SQLite database and vector index storage path. | `.nexo-palace/memory.sqlite3` |
| `ignoreDirs` | Directories excluded from doc and code scanning. | Standard list (`node_modules`, `.git`, `dist`, etc.). |

The configuration file is searched **upwards** from the current working directory, enabling command execution from any subdirectory.

> **Note:** All fields are optional. Nexo-Palace works out of the box for the vast majority of projects without manually authoring this file.

---

## Usage

### CLI

```bash
nexo-palace index                                  # Index documentation and source code
nexo-palace query "WCAG accessibility criteria"    # Run a hybrid search query
nexo-palace trace "components/menu/MenuEditor.tsx" # Inspect graph traceability
nexo-palace drift --dry-run                         # Detect architectural drift
nexo-palace decide --context "..." --decision "..." # Record a persistent decision
nexo-palace stats                                   # Display index statistics
nexo-palace serve                                   # Start MCP server over stdio
```

Global options: `--root <dir>` and `--config <file>`, which override automatic discovery.

---

### MCP Server

Configure Nexo-Palace in your MCP client configuration:

```json
{
  "mcpServers": {
    "nexo-palace": {
      "command": "nexo-palace",
      "args": ["serve"]
    }
  }
}
```

#### Tools Exposed via MCP

| Tool | Description |
| :--- | :--- |
| `memory_query(query, scope?, limit?, pathPrefix?)` | Hybrid search across documentation, code symbols, unit tests, and conventions. |
| `memory_status()` | Returns index statistics: nodes, chunks, vectors, and active embedding provider. |
| `memory_trace(entity, depth?)` | Extracts the traceability subgraph for a file or symbol: requirements, tests, documents, conventions, and dependencies. |
| `memory_record_decision(context, decision, tags?, relatedFiles?)` | Persists an architectural decision, links it in the graph, and appends it to the decisions file. |

To restrict the exposed tool surface during initial evaluation:

```bash
PALACE_TOOLS=phase1 nexo-palace serve
```

---

## How It Works

### 1. Document Indexing
The indexer walks `docs` and `tasteDirs`, splits Markdown files along header hierarchies, and extracts metadata.
The parser accepts YAML frontmatter when present or derives metadata from header lines (`**Date:**`, `**Status:**`, `Key: value` pipes).

Requirement status is resolved using the strongest available evidence:
1. Status column in requirement tables.
2. Inherited status from the parent epic containing the user story.
3. Document-level status.

### 2. Traceability Graph
The code extractor parses `codeDirs` using `ts-morph` and constructs a directed graph:

| Relationship | Source → Target | Evidence |
| :--- | :--- | :--- |
| `contains` | file → symbol | Exported declaration |
| `implements` | symbol → requirement | Requirement ID cited in a comment on the symbol |
| `tests` | test → module | Static or dynamic test import |
| `depends_on` | module → module | Real import statement resolved against `@/*` aliases |
| `references` | document → code | File path cited in documentation |
| `governed_by` | taste → code | File path cited in conventions/rules |

The graph relies strictly on observable evidence: cited paths, real imports, and explicit requirement IDs in comments. Relationships that cannot be grounded in code or text are never fabricated.

`memory_trace` differentiates direct from transitive connections: each element includes its distance in hops (`distance`), and `dependencies` / `dependents` only include hop-1 links.

### 3. Hybrid Search
Combines three distinct retrieval signals fused through Reciprocal Rank Fusion (RRF):
- **BM25** via SQLite FTS5 for exact keyword and identifier matching (`EPC-02`, `MenuEditor`).
- **Literal Identifier Matching** to preserve IDs across tokenization and diacritics.
- **Vector Proximity** (KNN search using `sqlite-vec`).

### 4. Decision Memory and Drift Detection
- `memory_record_decision` writes the decision into the `episodes` table, creates a graph node, computes embeddings, and appends it to `decisionsFile`. Because the file is tracked in Git and lives within indexed paths, future index runs naturally integrate it.
- `nexo-palace drift` inspects files modified in Git against requirements linked in the graph, flags affected requirements as `NEEDS_REVIEW`, and logs the drift event.

---

## Embedding Providers

Vector embeddings are pluggable:

| Provider | Description | Dim | Requirements |
| :--- | :--- | :--- | :--- |
| `litert` | Local service exposing OpenAI-compatible `/v1/embeddings` | 768 | Local server + downloaded model |
| `gemini` | Google AI API (`gemini-embedding-001` or `gemini-embedding-2-preview`) | 768 | `GEMINI_API_KEY` and quota |
| `ollama` | Direct Ollama integration | model-dependent | Running Ollama daemon |
| `offline` | Deterministic hash-TF-IDF, zero network | 384 | None |

Automatic resolution order: **LiteRT → Gemini → Ollama → offline**. You can override this using `PALACE_EMBED_PROVIDER` (`litert`, `gemini`, `ollama`, `offline`), `PALACE_EMBED_MODEL`, or the `--provider <name>` CLI flag.

> Switching providers does **not** happen silently. Even when dimensions match (e.g. LiteRT `nomic-embed-text` and Gemini `embedding-001` both use 768 dimensions), vector spaces are incompatible. Nexo-Palace prevents accidental mixing unless explicitly requested, which triggers a vector table rebuild.

### Incremental Reindexing
Each chunk stores a SHA-256 hash of its content. Subsequent runs only generate embeddings for modified chunks or chunks missing vectors; unchanged chunks keep their embeddings. An index run without content changes makes zero embedding API calls.

Chunks with fewer than 160 characters (`PALACE_MIN_EMBED_CHARS`) are skipped by the embedder to avoid wasting quota on low-entropy text. They remain fully searchable via lexical BM25.

### Gemini API Rate Limits
- `embed_content_free_tier_requests`: 100/min (throttled automatically via `PALACE_EMBED_MIN_INTERVAL_MS`, defaulting to 620 ms).
- Daily embedding requests: 1,000/day on the free tier. The engine reports remaining quota and reset timestamps when limits are reached without failing unpredictably.

### Gemini API Key Handling
The engine loads `.env` automatically (`.env` is git-ignored). **Never place API keys in `.env.example`**.
Project `.env` values take precedence over preexisting shell environment variables.

---

## SQLite Database Schema

Stored in a single SQLite file:

| Table | Description |
| :--- | :--- |
| `nodes` | Entities: documents, code modules, tests, symbols, requirements, taste conventions, decisions. |
| `edges` | Traceability graph links (`implements`, `tests`, `depends_on`, `references`…). |
| `chunks` | Indexable text chunks with `header_path` and extracted requirement tags. |
| `chunks_fts` | SQLite FTS5 index (BM25). |
| `chunks_vec` | Vector index (`sqlite-vec`). |
| `episodes` | Architectural decisions history. |
| `drift_events` | Detected code and requirement drift records. |
| `meta` | Index metadata (embedding dimensions, active provider, build timestamp). |

---

## Development

```bash
npm install
npm test          # End-to-end MCP smoke test against isolated fixture
npm run test:unit # Fast unit tests with Vitest
npm run bench     # Benchmark comparison across embedding providers
npm run typecheck # Strict TypeScript check
```

The smoke test is fully **self-contained**: it builds a mock repository in a temporary directory, indexes it, and asserts against all four MCP tools.

---

## Known Limitations

- Playwright tests (`e2e/`) testing HTTP endpoints without importing source components do not produce `tests` edges.
- The `implements` relation requires requirement IDs cited in code comments.
- The `offline` provider matches overlapping terms but does not capture semantic paraphrasing.
- `memory_trace` returns ambiguous matches under `candidates` rather than guessing a single entity.
- Chunks under 160 characters are excluded from vector generation (accessible via BM25 only).

---

## License

MIT.
