import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getConfig, initProject, resetConfig } from "../../src/config.ts";
import { openDb } from "../../src/db.ts";
import { OfflineEmbeddingProvider } from "../../src/embedder.ts";
import {
  extractCode,
  findCodePaths,
  isTestPath,
} from "../../src/extract-code.ts";
import {
  BashExtractor,
  createDefaultRegistry,
  CssExtractor,
  ExtractorRegistry,
  HtmlExtractor,
  PythonExtractor,
  SqlExtractor,
  TsExtractor,
} from "../../src/extractors/index.ts";

describe("Extractores políglotas y stack Angular / NestJS / Fullstack (Fase 2)", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "nexo-palace-polyglot-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    resetConfig();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("ExtractorRegistry", () => {
    it("registra y resuelve extractores para todo el stack (TS/JS/MJS/CJS, Python, HTML, CSS/SCSS/Less, SQL, Shell/Bash)", () => {
      const registry = createDefaultRegistry();
      expect(registry.getSupportedExtensions()).toEqual(
        expect.arrayContaining([
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mjs",
          ".cjs",
          ".mts",
          ".cts",
          ".py",
          ".html",
          ".css",
          ".scss",
          ".less",
          ".sql",
          ".sh",
          ".bash",
          ".zsh",
        ]),
      );

      expect(registry.getExtractorForPath("apps/frontend/src/app/main.ts")).toBeInstanceOf(TsExtractor);
      expect(registry.getExtractorForPath("tools/harvester.mjs")).toBeInstanceOf(TsExtractor);
      expect(registry.getExtractorForPath("tools/sync.cjs")).toBeInstanceOf(TsExtractor);
      expect(registry.getExtractorForPath("scripts/process.py")).toBeInstanceOf(PythonExtractor);
      expect(registry.getExtractorForPath("apps/frontend/src/app/login.component.html")).toBeInstanceOf(HtmlExtractor);
      expect(registry.getExtractorForPath("apps/frontend/src/app/login.component.scss")).toBeInstanceOf(CssExtractor);
      expect(registry.getExtractorForPath("apps/frontend/src/app/style.less")).toBeInstanceOf(CssExtractor);
      expect(registry.getExtractorForPath("db/schema.sql")).toBeInstanceOf(SqlExtractor);
      expect(registry.getExtractorForPath("scripts/setup.sh")).toBeInstanceOf(BashExtractor);
      expect(registry.getExtractorForPath("scripts/deploy.bash")).toBeInstanceOf(BashExtractor);
      expect(registry.getExtractorForPath("scripts/env.zsh")).toBeInstanceOf(BashExtractor);
    });
  });

  describe("isTestPath y findCodePaths con monorrepos y suite políglota", () => {
    it("reconoce suites de test en monorrepos (backend-e2e, frontend-e2e, spec, test)", () => {
      expect(isTestPath("apps/backend-e2e/src/app.spec.ts")).toBe(true);
      expect(isTestPath("apps/frontend-e2e/src/login.test.ts")).toBe(true);
      expect(isTestPath("tests/test_service.py")).toBe(true);
      expect(isTestPath("apps/backend/src/app/auth.service.spec.ts")).toBe(true);
      expect(isTestPath("apps/frontend/src/app/login.component.ts")).toBe(false);
    });

    it("encuentra menciones a archivos del stack en documentación", () => {
      const knownPaths = new Set([
        "apps/backend/src/app/user.service.ts",
        "apps/frontend/src/app/login.component.html",
        "apps/frontend/src/app/login.component.scss",
        "db/schema.sql",
        "tools/builder.mjs",
      ]);
      const doc = "Revisa `apps/backend/src/app/user.service.ts` y la plantilla `apps/frontend/src/app/login.component.html` junto con `db/schema.sql` y `tools/builder.mjs`.";
      const paths = findCodePaths(doc, knownPaths);
      expect(paths).toEqual(
        expect.arrayContaining([
          "apps/backend/src/app/user.service.ts",
          "apps/frontend/src/app/login.component.html",
          "db/schema.sql",
          "tools/builder.mjs",
        ]),
      );
    });
  });

  describe("TsExtractor con metadatos Angular y scripts ESM/CJS", () => {
    it("enlaza templateUrl y styleUrls de componentes Angular como dependencias directas", () => {
      const extractor = new TsExtractor();
      const code = `/**
 * Módulo de acceso.
 * @implements RF-01
 */
import { Component } from '@angular/core';

/**
 * Componente de login.
 * @implements RF-02
 */
@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  login() { return true; }
}
`;
      const knownPaths = new Set([
        "apps/frontend/src/app/login.component.ts",
        "apps/frontend/src/app/login.component.html",
        "apps/frontend/src/app/login.component.scss",
      ]);

      const result = extractor.extract(
        "apps/frontend/src/app/login.component.ts",
        code,
        {
          root: "/mock",
          knownPaths,
        },
      );

      expect(result.fileReqIds).toContain("RF-01");
      const compSym = result.symbols.find((s) => s.name === "LoginComponent");
      expect(compSym).toBeDefined();
      expect(compSym?.reqIds).toContain("RF-02");
      expect(result.importTargets).toEqual(
        expect.arrayContaining([
          "apps/frontend/src/app/login.component.html",
          "apps/frontend/src/app/login.component.scss",
        ]),
      );
    });

    it("soporta módulos .mjs y .cjs", () => {
      const extractor = new TsExtractor();
      const mjsCode = `/**
 * Herramienta de recolección de plantillas.
 * @implements RF-05
 */
export function harvestTemplates(slug) {
  return slug.toUpperCase();
}
`;
      const result = extractor.extract(
        "tools/template-harvester.mjs",
        mjsCode,
        {
          root: "/mock",
          knownPaths: new Set(["tools/template-harvester.mjs"]),
        },
      );

      expect(result.fileReqIds).toContain("RF-05");
      expect(result.symbols.some((s) => s.name === "harvestTemplates")).toBe(true);
    });
  });

  describe("HtmlExtractor (Plantillas Angular / Web)", () => {
    it("extrae componentes personalizados, referencias de formulario y requisitos", () => {
      const extractor = new HtmlExtractor();
      const htmlCode = `<!--
  Plantilla del formulario de acceso.
  @implements RF-03
-->
<div class="login-container">
  <app-navbar></app-navbar>
  <form (ngSubmit)="onLogin()" #loginForm="ngForm">
    <p-inputtext id="username" [(ngModel)]="username"></p-inputtext>
    <p-password id="password" [(ngModel)]="password"></p-password>
    <p-button label="Ingresar" type="submit"></p-button>
  </form>
</div>
`;
      const knownPaths = new Set([
        "apps/frontend/src/app/login.component.html",
        "apps/frontend/src/app/login.component.ts",
        "apps/frontend/src/app/login.component.scss",
      ]);

      const result = extractor.extract(
        "apps/frontend/src/app/login.component.html",
        htmlCode,
        {
          root: "/mock",
          knownPaths,
        },
      );

      expect(result.fileReqIds).toContain("RF-03");
      expect(result.headerComment).toContain("Plantilla del formulario");
      expect(result.symbols.some((s) => s.name === "app-navbar")).toBe(true);
      expect(result.symbols.some((s) => s.name === "p-button")).toBe(true);
      expect(result.symbols.some((s) => s.name === "#loginForm")).toBe(true);
      expect(result.importTargets).toEqual(
        expect.arrayContaining([
          "apps/frontend/src/app/login.component.ts",
          "apps/frontend/src/app/login.component.scss",
        ]),
      );
    });
  });

  describe("CssExtractor (SCSS / CSS / Less)", () => {
    it("extrae clases, mixins, directivas de import y requisitos", () => {
      const extractor = new CssExtractor();
      const scssCode = `/*
  Estilos del módulo de autenticación.
  @implements RF-04
*/
@use './variables.scss';

@mixin cardGlow {
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
}

.login-card {
  display: flex;
  background: rgba(255, 255, 255, 0.1);
}

.auth-button {
  padding: 1rem;
}
`;
      const knownPaths = new Set([
        "apps/frontend/src/app/login.component.scss",
        "apps/frontend/src/app/login.component.ts",
        "apps/frontend/src/app/variables.scss",
      ]);

      const result = extractor.extract(
        "apps/frontend/src/app/login.component.scss",
        scssCode,
        {
          root: "/mock",
          knownPaths,
        },
      );

      expect(result.fileReqIds).toContain("RF-04");
      expect(result.symbols.some((s) => s.name === "cardGlow" && s.kind === "mixin")).toBe(true);
      expect(result.symbols.some((s) => s.name === ".login-card")).toBe(true);
      expect(result.importTargets).toEqual(
        expect.arrayContaining([
          "apps/frontend/src/app/login.component.ts",
          "apps/frontend/src/app/variables.scss",
        ]),
      );
    });
  });

  describe("SqlExtractor (PostgreSQL / Scripts)", () => {
    it("extrae tablas, vistas, funciones, índices y requisitos", () => {
      const extractor = new SqlExtractor();
      const sqlCode = `-- Esquema de base de datos relacional
-- @implements RF-06

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL
);

-- @implements RF-07
CREATE TABLE profiles (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  full_name VARCHAR(100)
);

CREATE VIEW active_users AS
SELECT * FROM users;

CREATE INDEX idx_users_email ON users(email);
`;
      const knownPaths = new Set(["db/schema.sql"]);

      const result = extractor.extract("db/schema.sql", sqlCode, {
        root: "/mock",
        knownPaths,
      });

      expect(result.fileReqIds).toEqual(expect.arrayContaining(["RF-06", "RF-07"]));
      expect(result.symbols.some((s) => s.name === "users" && s.kind === "table")).toBe(true);
      expect(result.symbols.some((s) => s.name === "profiles" && s.kind === "table")).toBe(true);
      expect(result.symbols.some((s) => s.name === "active_users" && s.kind === "view")).toBe(true);
      expect(result.symbols.some((s) => s.name === "idx_users_email" && s.kind === "index")).toBe(true);
    });
  });

  describe("Autodescubrimiento de monorrepos en config.ts", () => {
    it("detecta automáticamente directorios de código en monorrepos estilo Nx/NestJS/Angular", () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, "apps", "backend", "src"), { recursive: true });
      mkdirSync(join(dir, "apps", "frontend", "src"), { recursive: true });
      mkdirSync(join(dir, "apps", "backend-e2e", "src"), { recursive: true });
      mkdirSync(join(dir, "tools"), { recursive: true });
      mkdirSync(join(dir, "shared"), { recursive: true });

      initProject({ root: dir });
      const cfg = getConfig();

      expect(cfg.codeDirs).toEqual(
        expect.arrayContaining([
          "apps/backend/src",
          "apps/frontend/src",
          "apps/backend-e2e/src",
          "tools",
          "shared",
        ]),
      );
    });
  });

  describe("End-to-End: extractCode políglota con todo el stack", () => {
    it("indexa un monorrepo completo con NestJS, Angular (TS + HTML + SCSS), SQL, Python y herramientas ESM", async () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, "apps", "backend", "src"), { recursive: true });
      mkdirSync(join(dir, "apps", "frontend", "src"), { recursive: true });
      mkdirSync(join(dir, "tools"), { recursive: true });
      mkdirSync(join(dir, "db"), { recursive: true });
      mkdirSync(join(dir, "docs"), { recursive: true });

      // Backend NestJS
      writeFileSync(
        join(dir, "apps", "backend", "src", "user.service.ts"),
        `/** @implements RF-11 */\nexport class UserService { getUser() { return { id: 1 }; } }\n`,
        "utf8",
      );

      // Frontend Angular TS Component
      writeFileSync(
        join(dir, "apps", "frontend", "src", "user.component.ts"),
        `import { Component } from '@angular/core';\n/** @implements RF-12 */\n@Component({ selector: 'app-user', templateUrl: './user.component.html', styleUrls: ['./user.component.scss'] })\nexport class UserComponent {}\n`,
        "utf8",
      );

      // Frontend Angular HTML Template
      writeFileSync(
        join(dir, "apps", "frontend", "src", "user.component.html"),
        `<!-- @implements RF-13 -->\n<div class="user-profile"><p-card #card></p-card></div>\n`,
        "utf8",
      );

      // Frontend Angular SCSS Style
      writeFileSync(
        join(dir, "apps", "frontend", "src", "user.component.scss"),
        `/* @implements RF-14 */\n.user-profile { padding: 1rem; }\n`,
        "utf8",
      );

      // Database SQL
      writeFileSync(
        join(dir, "db", "schema.sql"),
        `-- @implements RF-15\nCREATE TABLE users (id SERIAL PRIMARY KEY);\n`,
        "utf8",
      );

      // Tool script .mjs
      writeFileSync(
        join(dir, "tools", "sync.mjs"),
        `/** @implements RF-16 */\nexport function runSync() { return true; }\n`,
        "utf8",
      );

      // Shell script .sh
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(
        join(dir, "scripts", "setup.sh"),
        `#!/bin/bash\n# @implements RF-17\nfunction run_setup() { echo ok; }\n`,
        "utf8",
      );

      initProject({
        root: dir,
        dbPath: join(dir, "memory.sqlite3"),
      });

      const provider = new OfflineEmbeddingProvider();
      const db = openDb(join(dir, "memory.sqlite3"));

      const result = await extractCode(provider, { db });

      expect(result.files).toBeGreaterThanOrEqual(6);
      expect(result.errors).toHaveLength(0);

      // Comprobar que todos los nodos existen
      const backendNode = db.prepare("SELECT * FROM nodes WHERE id = ?").get("code:apps/backend/src/user.service.ts");
      expect(backendNode).toBeDefined();

      const htmlNode = db.prepare("SELECT * FROM nodes WHERE id = ?").get("code:apps/frontend/src/user.component.html");
      expect(htmlNode).toBeDefined();

      const scssNode = db.prepare("SELECT * FROM nodes WHERE id = ?").get("code:apps/frontend/src/user.component.scss");
      expect(scssNode).toBeDefined();

      const sqlNode = db.prepare("SELECT * FROM nodes WHERE id = ?").get("code:db/schema.sql");
      expect(sqlNode).toBeDefined();

      const toolNode = db.prepare("SELECT * FROM nodes WHERE id = ?").get("code:tools/sync.mjs");
      expect(toolNode).toBeDefined();

      const shNode = db.prepare("SELECT * FROM nodes WHERE id = ?").get("code:scripts/setup.sh");
      expect(shNode).toBeDefined();

      // Comprobar enlace Angular: user.component.ts -> user.component.html y .scss
      const linkHtml = db.prepare(
        "SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND relation = 'depends_on'",
      ).get("code:apps/frontend/src/user.component.ts", "code:apps/frontend/src/user.component.html");
      expect(linkHtml).toBeDefined();

      const linkScss = db.prepare(
        "SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND relation = 'depends_on'",
      ).get("code:apps/frontend/src/user.component.ts", "code:apps/frontend/src/user.component.scss");
      expect(linkScss).toBeDefined();

      // Comprobar trazabilidad implements
      const reqEdge = db.prepare(
        "SELECT * FROM edges WHERE source_id = ? AND target_id = 'req:RF-13' AND relation = 'implements'",
      ).get("code:apps/frontend/src/user.component.html");
      expect(reqEdge).toBeDefined();

      const shReqEdge = db.prepare(
        "SELECT * FROM edges WHERE source_id = ? AND target_id = 'req:RF-17' AND relation = 'implements'",
      ).get("code:scripts/setup.sh");
      expect(shReqEdge).toBeDefined();
    });
  });
});
