# Informe de Sesión: Blindaje, Identidad, TUI Interactiva y Publicación de Nexo-Palace

**Fecha:** 14 de Noviembre de 2026  
**Versión Publicada:** `@ijonydev/nexo-palace@0.1.1`  
**Repositorio:** [github.com/JonyDevProjects/nexo-palace](https://github.com/JonyDevProjects/nexo-palace)

---

## 1. Resumen Ejecutivo

En esta sesión se resolvió la auditoría de seguridad del instalador, se mejoró drásticamente la experiencia de usuario (DX/UX) con una terminal interactiva nativa (TUI), se dotó al motor de una identidad conceptual (*El Arquitecto del Sueño*), se implementó un diccionario bilingüe de normalización de requisitos, y se empaquetó y publicó exitosamente el proyecto en el registro público de NPM.

---

## 2. Hallazgos de Seguridad y Mejoras Estructurales Implementadas

### A. Permisos restrictivos y Escritura Atómica (`src/installer.ts`, `src/setup.ts`, `src/db.ts`)
- **Permisos `0700` / `0600`:** La base de datos SQLite local (`memory.sqlite3`), el directorio `.nexo-palace/`, el fichero `.env` y las configuraciones de clientes se crean con permisos POSIX restrictivos para prevenir lecturas no autorizadas en sistemas multiusuario.
- **Escritura Atómica con Backups:** Se implementó `writeJsonFileSecure` (escritura en `.tmp` + `renameSync`) y generación automática de `.bak` antes de modificar ficheros críticos de configuración.
- **Validación Estricta de JSON:** `readJsonFileSecure` lanza errores claros ante sintaxis inválida en lugar de devolver `{}` silenciosamente, protegiendo al usuario de pérdida de configuración previa.

### B. Ocultación de Credenciales (`src/embedder.ts`)
- Se eliminó el paso de `GEMINI_API_KEY` por query parameter (`?key=...`) en `discoverModel` y `embedOne`, migrándolo a la cabecera estándar de Google `x-goog-api-key` para prevenir filtraciones en logs de proxies o de red.

### C. Autodescubrimiento de Código y Documentación (`src/config.ts`, `src/util.ts`)
- Se ajustó el valor por defecto de `docs` a `["."]` para descubrir documentación en cualquier nivel del repositorio respetando `ignoreDirs`.
- Se introdujo `detectCodeDirs`: escanea automáticamente carpetas estándar (`src`, `lib`, `app`, `components`, `tests`) tanto en la raíz como en subproyectos de primer nivel (p. ej. `viz-app/src`, monorrepositorios), con fallback automático a `["."]` sin requerir configuración manual.
- Se actualizó `walkFiles` para admitir tanto rutas de directorios como archivos individuales evitando duplicados.

---

## 3. Identidad Conceptual y Naming de la Herramienta

- **Concepto:** **El Arquitecto del Sueño** (*The Dream Architect*, inspirado en *Inception* / Método de Loci).
- **Rol:** **El Arquitecto** — responsable de cartografiar el repositorio, estructurar los recuerdos y tejer el grafo de trazabilidad entre documentación, requisitos y código.
- **Acción / Comando:** **`map`** (manteniendo `index` como alias retrocompatible).
- **Binarios CLI:** `nexo-palace` y el alias abreviado **`nxpl`**.

---

## 4. Diccionario de Prefijos y Normalización Cruzada Bilingüe

Para resolver proyectos tanto en español (IEEE / MÉTRICA v3) como en inglés (Scrum / SAFe), se amplió `requirementPrefixes` por defecto y se incorporó el mapa `ALIASES` en `src/markdown.ts`:

| Concepto | Variantes / Inglés | Forma Canónica | Ejemplo Normalizado |
| :--- | :--- | :--- | :--- |
| **Requisito Funcional** | `FR`, `FUNC` | `RF` | `FR-001` → `RF-001` |
| **Requisito No Funcional** | `NFR`, `NONFUNC` | `RNF` | `NFR-04` → `RNF-04` |
| **Historia de Usuario** | `HU`, `HDU`, `STORY`, `HISTORY` | `US` | `HU-101` → `US-101` |
| **Épica** | `EPIC`, `EP` | `EPC` | `EPIC 01` → `EPC-01` |
| **Caso de Uso** | `UC` | `CU` | `UC-10` → `CU-10` |
| **Tarea** | `TSK`, `TAR` | `TASK` | `TSK-05` → `TASK-05` |
| **Defecto / Bug** | `FIX`, `DEF` | `BUG` | `FIX-12` → `BUG-12` |
| **Caso de Prueba** | `TC`, `TEST` | `CP` | `TC-01` → `CP-01` |
| **Criterio de Aceptación** | `AC` | `CA` | `AC-02` → `CA-02` |

---

## 5. Nueva Interfaz de Usuario de Terminal (TUI) y Feedback en Tiempo Real

Se creó `src/tui.ts` utilizando primitivas estándar de Node (`node:readline` y escapes ANSI) sin añadir dependencias externas pesadas:
- **Menú interactivo con teclado:** Navegación fluida con `↑`/`↓` o `j`/`k`, selección con `Espacio` o `Enter`.
- **Detección en tiempo real:** Detecta si servicios locales (LiteRT u Ollama) están levantados y los marca con `[EN EJECUCIÓN]`.
- **Mapeo post-instalación:** Tras configurar el proveedor, el instalador pregunta interactivamente si se desea cartografiar el proyecto en el acto.
- **Barra de Progreso (`ProgressBar`):** Feedback visual continuo mostrando porcentaje, conteo de ficheros y el archivo en procesamiento durante la ingesta documental y la extracción AST de código.

---

## 6. Cobertura de Pruebas Unitarias

Se alcanzó una suite completa de **5 archivos de test y 24 tests unitarios** en Vitest, todos pasando:
- `tests/unit/util.test.ts` (13 tests): hashing, nodos, filtrado de markdown, recorrido recursivo.
- `tests/unit/installer.test.ts` (3 tests): permisos 0600, escritura atómica, backups y rechazo de JSON corrupto.
- `tests/unit/config.test.ts` (3 tests): autodescubrimiento de `docs` y subdirectorios de código.
- `tests/unit/markdown-requirements.test.ts` (4 tests): extracción multilingüe y normalización cruzada.
- `tests/unit/tui.test.ts` (1 test): renderizado y actualización de barra de progreso.

---

## 7. Publicación en el Registro Oficial de NPM

- **Paquete:** `@ijonydev/nexo-palace`
- **Versión:** `0.1.1`
- **Comando de instalación y uso rápido:**
  ```bash
  # Asistente interactivo
  npx @ijonydev/nexo-palace setup

  # Cartografía del repositorio
  npx @ijonydev/nexo-palace map

  # Servidor MCP para agentes
  npx @ijonydev/nexo-palace serve
  ```
