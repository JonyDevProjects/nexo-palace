# Nexo-Palace

Memoria de proyecto para agentes.

Convierte la documentación, el código y las convenciones de un repositorio en
un **índice híbrido** (semántico + léxico) y un **grafo de trazabilidad**, y lo
expone como CLI y como **servidor MCP** para que cualquier agente consulte lo
que el proyecto ya sabe en lugar de releer ficheros linealmente.

Todo es local: un único fichero SQLite, sin servicios en la nube.

```
┌──────────────┐   index    ┌──────────────┐   query    ┌──────────────┐
│  docs/       │ ─────────► │  SQLite      │ ◄───────── │  agentes     │
│  código      │            │  FTS5 + vec  │            │  MCP / CLI   │
│  taste/      │            │  + grafo     │            └──────────────┘
└──────────────┘            └──────────────┘
```

## Requisitos Previos

Antes de instalar Nexo-Palace, verifica contar con:

- **Node.js `>= 22.6.0`** (imprescindible para el *type-stripping* nativo de TypeScript y soporte SQLite moderno).
- **npm `>= 10.0.0`** (o equivalente pnpm / yarn).
- **Proveedor de Embeddings** (opcional pero recomendado para búsqueda semántica vectorial):
  - **Opción A (Nube / Gratis):** Una API key de Google AI Studio (`GEMINI_API_KEY`). No requiere instalar ningún servicio local ni consume GPU/RAM.
  - **Opción B (Local / Privado):** Python `>= 3.9` con `mlc-ai-litert`, u **Ollama** con el modelo `nomic-embed-text`.
  - **Opción C (Cero dependencias / Offline):** Sin ningún proveedor externo (búsqueda léxica BM25 pura).

---

## Instalación

### Instalación Rápida con Asistente Interactivo (Recomendada)
En la raíz de cualquier proyecto que desees cartografiar:

```bash
npx @ijonydev/nexo-palace setup
```
El asistente interactivo:
1. Detectará si tienes servicios locales corriendo (`litert`, `ollama`).
2. Te permitirá seleccionar el proveedor con las flechas del teclado (`↑`/`↓`) y confirmar con `Espacio` o `Enter`.
3. Guardará la configuración protegida (`0600`) y te ofrecerá **cartografiar el proyecto de inmediato**.

---

### Instalación como Dependencia en un Proyecto

```bash
npm install --save-dev @ijonydev/nexo-palace
```

Binarios disponibles tras instalar: **`nxpl`** (alias rápido) y **`nexo-palace`**.

---

## Guía de Configuración por Casos de Uso

### Caso 1: Sin servicios locales, aprovechando Embeddings en la Nube (Gemini)
Ideal si quieres máxima velocidad y semántica de alta calidad sin levantar servicios pesados en tu máquina:
1. Obtén tu API Key gratuita en [aistudio.google.com](https://aistudio.google.com/).
2. En la raíz de tu proyecto, crea o ajusta `nexo-palace.config.json`:
   ```json
   {
     "PALACE_EMBED_PROVIDER": "gemini"
   }
   ```
3. Añade tu clave en `.env`:
   ```bash
   GEMINI_API_KEY="AIzaSy..."
   ```
4. Cartografía el proyecto:
   ```bash
   npx nxpl map
   ```

### Caso 2: Entornos 100% Locales y Privados (Ollama o LiteRT)
- **Con Ollama:**
  ```bash
  ollama pull nomic-embed-text
  npx nxpl map --provider ollama
  ```
- **Con LiteRT:**
  ```bash
  pip install mlc-ai-litert
  python -m litert.serve --port 11435
  npx nxpl map --provider litert
  ```

### Caso 3: Modo Offline (Sin Red ni Motores Externos)
Utiliza búsqueda léxica BM25 nativa en SQLite (FTS5). No requiere internet ni dependencias externas:
```bash
npx nxpl map --provider offline
```

---

## Cómo pedirle a tu Asistente IA que lo instale y configure

Si estás usando Claude Code, Cursor, Windsurf, Antigravity o CommandCode, puedes copiar y pegar estos prompts:

### Prompt General (Si tienes LiteRT u Ollama local)
> "Instala `@ijonydev/nexo-palace` como dependencia de desarrollo (`npm install -D @ijonydev/nexo-palace`). Configura `nexo-palace.config.json` con `"PALACE_EMBED_PROVIDER": "litert"` (u `"ollama"`), ejecuta `npx nxpl map` para cartografiar el repositorio y añade el servidor MCP con el comando `npx` y argumentos `["--no-install", "nxpl", "serve"]`."

### Prompt para usar Gemini API (Sin instalar servidores locales)
> "Quiero instalar `@ijonydev/nexo-palace` con embeddings de Gemini. Instálalo como devDependency (`npm install -D @ijonydev/nexo-palace`), pon `"PALACE_EMBED_PROVIDER": "gemini"` en `nexo-palace.config.json` y asegúrate de que exista `GEMINI_API_KEY` en el `.env` (pídeme la clave si no la tienes). Luego corre `npx nxpl map` y registra el servidor MCP (`nxpl serve`)."

---

## Configuración del proyecto

Nexo-Palace está diseñado con **cero configuración obligatoria**: al ejecutar `npx nxpl map`, **El Arquitecto** autodescubre la estructura del repositorio:
- **Documentación:** Escanea automáticamente cualquier archivo `.md` del proyecto desde la raíz (`["."]`) respetando las carpetas ignoradas (`ignoreDirs`).
- **Código:** Detecta carpetas estándar (`src`, `lib`, `app`, `components`, `tests`, etc.) tanto en la raíz como en **subproyectos de primer nivel** (p. ej. `viz-app/src`, `packages/core/src`), con fallback a `["."]`.
- **Convenciones y Gustos (`taste`):** Detecta automáticamente directorios de convenciones y decisiones existentes, como `.commandcode/taste`, `docs/adr`, `docs/adrs` o `docs/decisions`.
- **Requisitos multilingües:** Reconoce de serie prefijos en español e inglés (`RF`, `RNF`, `FR`, `NFR`, `HU`, `US`, `CU`, `UC`, `EPC`, `EPIC`, `REQ`, `TASK`, `TSK`, `ADR`, `RFC`, `SPEC`, `TC`, `CP`, `AC`, `CA`, `BUG`, `FIX`, `WP`) y aplica **normalización cruzada** automática (p. ej. `FR-001` → `RF-001`, `HU-101` → `US-101`, `UC-10` → `CU-10`).

Si tu proyecto necesita personalizar rutas, exclusiones o prefijos específicos, crea un `nexo-palace.config.json` en su raíz:

```json
{
  "projectName": "mi-proyecto",

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

| Clave | Para qué sirve | Por defecto (Autodescubierto) |
| :--- | :--- | :--- |
| `projectName` | Nombre del proyecto en las descripciones del servidor MCP. | El nombre de la carpeta raíz. |
| `docs` | Directorios o archivos individuales Markdown a cartografiar. | `["."]` (toda la doc del repo). |
| `tasteDirs` | Directorios de convenciones y decisiones de equipo (`taste`). | Autodetecta `.commandcode/taste`, `docs/adr*`, `docs/decisions`. |
| `codeDirs` | Directorios analizados por el extractor AST (`ts-morph`). | Autodetecta `src/`, `lib/`, etc. en raíz y subcarpetas. |
| `codeExtensions` | Extensiones de código indexables en el grafo. | `[".ts", ".tsx", ".js", ".jsx"]` |
| `requirementPrefixes` | Prefijos de trazabilidad reconocidos (`RF-01`, `US-101`…). | 24 prefijos estándar ES/EN con normalización cruzada. |
| `decisionsFile` | Archivo Markdown donde se acumulan las decisiones registradas. | `docs/decisions.md` (o `.nexo-palace/decisions.md`). |
| `dbPath` | Ruta de la base de datos SQLite y vectores. | `.nexo-palace/memory.sqlite3` |
| `ignoreDirs` | Directorios excluidos del escaneo documental y de código. | Lista estándar (`node_modules`, `.git`, `dist`, etc.). |

El fichero se busca **hacia arriba** desde el directorio actual, de modo que funciona desde cualquier subcarpeta del proyecto.

> **Nota:** Todos los campos son opcionales. En la gran mayoría de proyectos (incluyendo proyectos organizados con CommandCode o monorrepositorios), Nexo-Palace funciona de forma óptima sin necesidad de crear este fichero.

## Uso

### CLI

```bash
nexo-palace index                                  # indexa documentación y código
nexo-palace query "criterios de aceptación WCAG"    # consulta híbrida
nexo-palace trace "components/menu/MenuEditor.tsx"   # traza el grafo
nexo-palace drift --dry-run                         # detecta deriva
nexo-palace decide --context "..." --decision "..." # registra una decisión
nexo-palace stats                                   # estado del índice
nexo-palace serve                                   # servidor MCP por stdio
```

Opciones globales: `--root <dir>` y `--config <fichero>`, que tienen prioridad
sobre la detección automática.

### Servidor MCP

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

Expone cuatro herramientas:

| Herramienta | Qué hace |
| :--- | :--- |
| `memory_query(query, scope?, limit?, pathPrefix?)` | Búsqueda híbrida sobre documentación, código, tests y convenciones. |
| `memory_status()` | Estado del índice: nodos, fragmentos, vectores y proveedor de embeddings. |
| `memory_trace(entity, depth?)` | Subgrafo de trazabilidad de un archivo o símbolo: requisitos, tests, documentos, convenciones y dependencias. |
| `memory_record_decision(context, decision, tags?, relatedFiles?)` | Persiste una decisión y la enlaza en el grafo y en el fichero de decisiones. |

Para restringir la superficie mientras se valida:

```bash
PALACE_TOOLS=phase1 nexo-palace serve
```

## Cómo funciona

### 1. Indexación documental

El indexador recorre los directorios `docs` y `tasteDirs`, trocea cada Markdown
por su jerarquía de encabezados y extrae los metadatos.

El parser acepta YAML frontmatter si existe y, si no, deduce los metadatos del
encabezado del documento (`**Date:**`, `**Status:**`, líneas `Clave: valor`
separadas por `|`).

El estado de cada requisito se resuelve con la evidencia más fuerte
disponible, en este orden:

1. La columna de estado de las tablas de estado.
2. El estado heredado de la épica que contiene la historia de usuario.
3. El estado del documento.

### 2. Grafo de trazabilidad

El extractor de código recorre `codeDirs` con `ts-morph` y construye un grafo
dirigido:

| Relación | Origen | Evidencia |
| :--- | :--- | :--- |
| `contains` | archivo → símbolo | declaración exportada |
| `implements` | símbolo → requisito | ID de requisito en un comentario del símbolo |
| `tests` | test → módulo | import estático o dinámico del test |
| `depends_on` | módulo → módulo | imports reales, resueltos con el alias `@/*` |
| `references` | documento → código | el documento cita la ruta del archivo |
| `governed_by` | taste → código | la convención cita la ruta del archivo |

El grafo se apoya solo en evidencia observable: rutas citadas, imports reales e
identificadores en comentarios. Una relación que no se puede señalar no se
declara.

`memory_trace` distingue lo directo de lo transitivo: cada elemento lleva su
`distance` en saltos, y `dependencies` y `dependents` solo incluyen enlaces de
distancia 1.

### 3. Búsqueda híbrida

La búsqueda combina tres señales y las fusiona con Reciprocal Rank Fusion:

- **BM25** sobre FTS5, para identificadores exactos (`EPC-02`, `MenuEditor`).
- **Coincidencia literal** de identificadores, que sobrevive a la tokenización
  de FTS5 y a los acentos.
- **Vecindad vectorial** (KNN de `sqlite-vec`).

### 4. Memoria decisional y deriva

`memory_record_decision` guarda la decisión en la tabla `episodes`, crea su
nodo en el grafo, la indexa con embeddings y deja constancia en el fichero
`decisionsFile` — dentro del directorio que el indexador ya recorre, de modo
que la decisión queda versionada junto al código y el indexador la recoge en la
siguiente pasada.

`nexo-palace drift` compara los archivos modificados según Git con los
requisitos enlazados a ese código, marca los afectados como `NEEDS_REVIEW` y
registra el evento.

## Proveedor de embeddings

La capa de vectores es enchufable:

| Proveedor | Qué es | Dim | Requiere |
| :--- | :--- | :--- | :--- |
| `litert` | Servicio local con la forma de la API de OpenAI (`/v1/embeddings`) | 768 | Un servicio local + modelo descargado |
| `gemini` | API de Google (`gemini-embedding-001` o `gemini-embedding-2-preview`) | 768 | `GEMINI_API_KEY` y cuota |
| `ollama` | Ollama directo, sin servicio intermedio | según modelo | Ollama en marcha |
| `offline` | hash-TF-IDF determinista, sin red | 384 | nada |

El orden de resolución en modo automático es **LiteRT → Gemini → Ollama →
offline**. Se puede forzar con `PALACE_EMBED_PROVIDER` (`litert`, `gemini`,
`ollama`, `offline`), con `PALACE_EMBED_MODEL` o con `--provider <nombre>` al
indexar.

> El cambio de proveedor **no** se hace en silencio. Aunque dos modelos tengan
> la misma dimensión (LiteRT `nomic-embed-text` y Gemini `embedding-001` usan
> 768), sus vectores no son comparables entre sí, así que el motor rechaza
> reindexar con otro proveedor salvo que se indique explícitamente, que es lo
> que autoriza reconstruir la tabla vectorial.

### Reindexación incremental

Cada fragmento guarda el hash de su contenido. En la siguiente indexación solo
se embeben los fragmentos cuyo texto ha cambiado o que aún no tienen vector;
el resto conserva su embedding. Una reindexación sin cambios no llama a la
API.

Los fragmentos de menos de 160 caracteres (`PALACE_MIN_EMBED_CHARS`) no se
embeben: aportan poco valor semántico y consumen cuota. Siguen siendo
recuperables por la vía léxica.

### Cuota de la API de Gemini

Dos límites condicionan el uso de la API:

| Límite | Valor | Efecto |
| :--- | :--- | :--- |
| `embed_content_free_tier_requests` por minuto | 100 | Se cubre con un intervalo mínimo entre peticiones (`PALACE_EMBED_MIN_INTERVAL_MS`, 620 ms por defecto). |
| Peticiones de embedding **por día** | 1000 | Es el límite real. El motor informa de cuándo se restablece. |

El motor no falla de forma opaca cuando se agota la cuota diaria: informa del
límite, de la hora de restablecimiento y de que los fragmentos ya indexados
conservan su vector.

### La clave de Gemini

El motor lee el `.env` del proyecto (ya está en `.gitignore`). **La clave nunca
debe ir en `.env.example`**: ese fichero está versionado en git.

```bash
# .env
GEMINI_API_KEY=tu-clave-aquí
```

El `.env` del proyecto **tiene prioridad** sobre las variables ya exportadas en
la shell: una clave antigua en la shell no debe dejar de usar una clave válida
del repositorio.

## Esquema

Un único fichero SQLite:

| Tabla | Contenido |
| :--- | :--- |
| `nodes` | Entidades: documentos, código, tests, símbolos, requisitos, taste, decisiones. |
| `edges` | Grafo de trazabilidad (`implements`, `tests`, `depends_on`, `references`…). |
| `chunks` | Fragmentos indexables con su `header_path` y sus requisitos. |
| `chunks_fts` | Índice FTS5 (BM25). |
| `chunks_vec` | Índice vectorial (`sqlite-vec`). |
| `episodes` | Decisiones registradas. |
| `drift_events` | Eventos de deriva detectados. |
| `meta` | Parámetros del build del índice (dimensión, proveedor, fecha). |

## Desarrollo

```bash
npm install
npm test          # prueba de humo del servidor MCP, con fixture propio
npm run bench     # comparativa de proveedores de embeddings
npm run typecheck
```

La prueba de humo es **autónoma**: crea su propio proyecto de fixture en un
directorio temporal, lo indexa y verifica las cuatro herramientas contra ese
corpus. No depende del proyecto donde vive el paquete.

## Limitaciones conocidas

- Los tests de Playwright (`e2e/`) que no importan componentes no generan
  aristas `tests`: ejercitan rutas, no módulos.
- La arista `implements` exige que el código cite el ID del requisito. Un
  módulo que implementa un requisito sin citarlo no queda enlazado.
- El proveedor `offline` no captura paráfrasis: solo solapamiento de términos.
- `memory_trace` no resuelve ambigüedades por sí solo: cuando hay varios
  candidatos devuelve la lista en `candidates` en lugar de elegir uno.
- Los fragmentos de menos de 160 caracteres no se embeben. Siguen siendo
  recuperables por la vía léxica, pero no aparecen en los resultados que solo
  usan la señal vectorial.
- El modelo local `nomic-embed-text` es de 2024 y está entrenado sobre texto en
  inglés: con un corpus en español rinde por debajo de Gemini Embedding 2 en
  cobertura (top-5), aunque empata en precisión.

## Licencia

MIT.
