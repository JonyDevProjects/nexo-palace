# Contributing to Nexo-Palace

Thank you for your interest in contributing to **Nexo-Palace**! We welcome bug reports, feature suggestions, documentation enhancements, and pull requests from developers worldwide.

This guide provides guidelines and setup instructions to help you contribute effectively.

---

## 1. Development Requirements

Make sure your local environment meets the following baseline requirements:

- **Node.js:** `>= 22.6.0` (required for native TypeScript `--experimental-strip-types` support and modern SQLite capabilities).
- **npm:** `>= 10.0.0` (or compatible package managers like `pnpm` / `yarn`).
- **Git:** modern version supporting worktrees and submodules if needed.

---

## 2. Gitflow & Branching Strategy

We follow a structured Gitflow model for repository evolution:

- **`main` Branch:**
  - Production and release-ready code.
  - Every release tag is cut directly from `main`.
- **`develop` Branch:**
  - Active integration branch for upcoming features.
  - Pull requests targeting new functionality or internal refactoring should be opened against `develop`.
- **`feature/<name>` Branches:**
  - All new features, performance improvements, or major documentation sets must be developed on a dedicated branch branched off `develop` (e.g. `feature/P3-docs-i18n`, `feature/sqlite-vec-optimizations`).
- **`fix/<name>` / `hotfix/<name>` Branches:**
  - Bug fixes targeting `develop` or critical patch releases targeting `main`.

---

## 3. Commit Style & Conventions

We enforce [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>?): <description>
```

### Allowed Types
- **`feat:`** A new feature or capability.
- **`fix:`** A bug fix.
- **`docs:`** Documentation changes only.
- **`test:`** Adding or refactoring unit, integration, or smoke tests.
- **`ci:`** Changes to CI/CD workflows, build scripts, or repository tooling.
- **`refactor:`** Code changes that neither fix a bug nor add a feature.
- **`chore:`** Maintenance tasks, dependency updates, or metadata changes.

### Example Commit Messages
- `feat(graph): add transitive dependency cycle detection`
- `fix(embedder): handle gemini rate-limit 429 backoff gracefully`
- `docs: add english readme, language switcher and contributing guide`
- `test(mcp): add assertion for memory_record_decision tool`

---

## 4. Local Validation Scripts

Before submitting a Pull Request, make sure all local verification steps pass:

```bash
# 1. Install dependencies
npm install

# 2. Typecheck without emitting JS (validates TypeScript types strictly)
npm run typecheck

# 3. Run fast unit test suites
npm run test:unit

# 4. Run MCP integration smoke test
npm test

# 5. Verify packaging bundle integrity
npm pack --dry-run
```

All CI validation checks must pass green before a Pull Request can be merged.

---

## 5. Code Guidelines & Architectural Principles

- **Modern TypeScript with Native Type Stripping:**
  - We execute source files directly using Node's `--experimental-strip-types`.
  - All relative local imports must explicitly include the `.ts` extension (e.g., `import { PalaceConfig } from "./config.ts";`).
  - Do not use runtime TypeScript features that require code transformation (e.g., avoid `const enum` or legacy parameter decorators).
- **Strict Typing:**
  - Avoid using `any`. Use `unknown`, generic parameters, or explicit Zod validation schemas instead.
  - Verify strict null checks (`strict: true` in `tsconfig.json`).
- **Zero Cloud Lock-in & Local First:**
  - Core functionality (parsing, AST extraction, SQLite indexation, BM25 retrieval) must operate completely offline.
  - Vector embeddings must always have an offline fallback (`offline` hash-TF-IDF provider).
- **Observable Evidence in Traceability:**
  - The traceability graph only records relationships backed by observable evidence (explicit AST imports, paths cited in docs, or `@implements` / requirement tags). Never invent relationships based on heuristics without grounds.

---

## 6. Submitting a Pull Request

1. Fork or branch from `develop`.
2. Implement your changes following our code style and commit message conventions.
3. Add or update unit tests in `tests/unit/` covering your changes.
4. Run all validation scripts (`npm run typecheck`, `npm run test:unit`, `npm pack --dry-run`).
5. Open a Pull Request against `develop` with a clear description of the problem solved and the implementation details.

---

## License

By contributing to **Nexo-Palace**, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
