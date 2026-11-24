# Especificación Técnica: P6 — Extractor de Scripts Shell / Bash (`BashExtractor`)

**Objetivo:** Extender las capacidades políglotas del motor de memoria de `nexo-palace` para analizar, indexar y trazar dependencias y requisitos en scripts de automatización e infraestructura escritos en Shell / Bash (`.sh`, `.bash`, `.zsh`).

---

## 1. Contexto y Justificación

En proyectos modernos de desarrollo de software, agentes de IA, benchmarks y despliegue local, una parte sustancial de la lógica operativa y flujos de infraestructura reside en scripts de Shell (por ejemplo: `setup.sh`, `benchmark.sh`, `deploy.sh`, scripts de harness y contenedores).

### Problema Actual
- `DEFAULT_CONFIG.codeExtensions` en [`src/config.ts`](file:///home/antigravity/JonyDevProjects/nexo-palace/src/config.ts) solo contempla lenguajes como `.ts`, `.js`, `.py`, `.html`, `.css`, `.sql`, omitiendo extensiones de shell.
- `ExtractorRegistry.getExtractorForPath(file)` devuelve `undefined` para scripts de shell.
- Durante `extractCode` (comando `map`), estos scripts son ignorados silenciosamente, impidiendo que sus funciones, variables de configuración y directivas `@implements` se integren en el grafo de trazabilidad SQLite y en las búsquedas híbridas (BM25 + `sqlite-vec`).

### Referencia
- **Issue vinculada:** [Issue #1: feat(extractors): soporte para indexación y análisis de scripts Shell / Bash (.sh, .bash, .zsh)](https://github.com/JonyDevProjects/nexo-palace/issues/1).

---

## 2. Alcance y Extensiones Soportadas

- **Extensiones cubiertas:** `.sh`, `.bash`, `.zsh`.
- **Directorios clave:** Asegurar que carpetas operativas habituales como `scripts/`, `bin/`, `infra/`, `deploy/` y `tools/` sean consideradas dentro de la detección de directorios de código en [`src/config.ts`](file:///home/antigravity/JonyDevProjects/nexo-palace/src/config.ts).

---

## 3. Arquitectura y Diseño Técnico (`BashExtractor`)

El nuevo extractor implementará la interfaz `LanguageExtractor` definida en [`src/extractors/types.ts`](file:///home/antigravity/JonyDevProjects/nexo-palace/src/extractors/types.ts).

### 3.1. Parsing AST vía `tree-sitter`
Siguiendo la arquitectura de [`PythonExtractor`](file:///home/antigravity/JonyDevProjects/nexo-palace/src/extractors/python-extractor.ts), se utilizará `tree-sitter` junto con la gramática oficial `tree-sitter-bash`:
- **Dependencia a añadir:** `tree-sitter-bash` (`^0.25.1`), compatible con la versión actual de `tree-sitter` instalada (`^0.25.1`).
- **Resiliencia / Fallback:** En caso de errores puntuales de sintaxis o scripts heterogéneos, el extractor debe continuar degradando graciosamente sin interrumpir el proceso de ingesta global.

### 3.2. Extracción de Símbolos (`ExtractedSymbol`)
Para cada script analizado, `BashExtractor` extraerá:
1. **Definiciones de Funciones:**
   - Sintaxis `function nombre() { ... }` y `nombre() { ... }`.
   - `name`: Nombre de la función.
   - `kind`: `"function"`.
   - `signature`: Firma normalizada de la función (ej. `nombre()`).
   - `doc`: Comentarios adyacentes precedentes (`# ...`) que describan su propósito.
   - `line`: Número de línea inicial en el script (1-indexed).
2. **Variables Globales y de Entorno Exportadas:**
   - Asignaciones globales de configuración y sentencias `export NOMBRE=...`.
   - `kind`: `"variable"`.
   - `signature`: `export NOMBRE` o `NOMBRE=...`.
3. **Requisitos Asociados:**
   - Extracción de `@implements RF-XX` o menciones de requisitos tanto en el comentario de cabecera del script (`fileReqIds`), en los comentarios de documentación de cada función (`reqIds`) como en el cuerpo de la misma (`bodyReqIds`).

### 3.3. Detección de Dependencias e Imports (`importTargets`)
Los scripts de shell vinculan otros módulos mediante sourcing o ejecución encadenada:
- **Directivas `source` y `.`:**
  - `source ./scripts/common.sh` o `. ./env.sh`.
- **Resolución de rutas:**
  - Normalización de rutas relativas respecto al directorio del script o la raíz del repositorio.
  - Validación contra `knownPaths` (proporcionado por `ExtractorContext`) para enlazar dependencias en el grafo (`importTargets`).

---

## 4. Archivos a Modificar y Crear

| Archivo | Acción | Descripción |
| :--- | :--- | :--- |
| `package.json` | Modificar | Agregar dependencia `"tree-sitter-bash": "^0.25.1"` |
| `src/extractors/bash-extractor.ts` | **Crear** | Implementación de `BashExtractor` con parsing AST `tree-sitter-bash` |
| `src/extractors/registry.ts` | Modificar | Registrar `new BashExtractor()` en `createDefaultRegistry()` |
| `src/extractors/index.ts` | Modificar | Exportar `BashExtractor` |
| `src/config.ts` | Modificar | Añadir `.sh`, `.bash`, `.zsh` a `DEFAULT_CONFIG.codeExtensions` e incluir `"scripts"` en `DEFAULT_CONFIG.codeDirs` |
| `tests/unit/bash-extractor.test.ts` | **Crear** | Suite de pruebas unitarias específicas para `BashExtractor` |
| `tests/unit/polyglot-extractors.test.ts` | Modificar | Ampliar pruebas del registro por defecto y resolución de extensiones |

---

## 5. Casos de Prueba Requeridos

### A. Pruebas Unitarias de `BashExtractor` (`tests/unit/bash-extractor.test.ts`)
1. **Extracción de funciones:**
   - Parsear scripts con funciones de estilo POSIX `clean_cache() { ... }` y Bash `function build_app() { ... }`.
   - Verificar extracción correcta de nombres, líneas y comentarios asociados.
2. **Extracción de comentarios y requisitos:**
   - Script con cabecera descriptiva y directiva `# @implements RF-007`.
   - Función con comentario específico `# @implements RF-008`.
3. **Resolución de `source` y `. `:**
   - Sentencias `source ./lib/utils.sh` y `. ./config.env.sh` deben poblar `importTargets`.
4. **Tolerancia a errores de sintaxis:**
   - Scripts con comandos incompletos o constructos no estándar deben parsearse sin lanzar excepciones no controladas.

### B. Pruebas de Integración con el Registro y Motor (`tests/unit/polyglot-extractors.test.ts`)
- Comprobar que `createDefaultRegistry().getExtractorForPath("scripts/setup.sh")` resuelve una instancia de `BashExtractor`.
- Comprobar que el comando de indexación `extractCode` crea los nodos de tipo `code` y `symbol` correspondientes en una base de datos SQLite en memoria.

---

## 6. Criterios de Aceptación

1. **Compilación y Tipado:** `npm run typecheck` se ejecuta con 0 errores de TypeScript (`--noEmit`).
2. **Suite de Pruebas:** Todos los tests pasan en verde con `npm run test:unit`.
3. **Sin Regresiones:** Las suites existentes (`polyglot-extractors`, `trace`, `query`, `installer`) se mantienen al 100% funcionales.
4. **Gobernanza Gitflow:**
   - Rama de feature recomendada: `feature/P6-bash-extractor` o `feat/issue-1-bash-extractor`.
   - Commit con formato Conventional Commits: `feat(extractors): add BashExtractor for .sh, .bash and .zsh scripts (fixes #1)`.
