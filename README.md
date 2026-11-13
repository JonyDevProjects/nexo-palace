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

## Instalación

```bash
npm install -g nexo-palace
```

O como dependencia local del proyecto:

```bash
npm install --save-dev nexo-palace
```

Requiere Node 22.6 o superior. Después de instalar, se ejecuta automáticamente `npm run setup` que detecta proveedores locales de embeddings disponibles.

## Proveedores de embeddings

La búsqueda semántica requiere un proveedor de embeddings. La prioridad de detección automática es **litert → ollama → offline**.

### LiteRT (recomendado)

Servicio standalone que expone la API OpenAI-compatible `/v1/embeddings`:

```bash
# Instalar
pip install mlc-ai-litert

# Arrancar servicio en puerto 11435
python -m litert.serve --port 11435

# Usa el modelo nomic-embed-text (descargado automáticamente)
PALACE_EMBED_PROVIDER=litert node_modules/.bin/nexo-palace index
```

### Ollama (alternativa sencilla)

```bash
# macOS
brew install ollama && ollama pull nomic-embed-text && ollama serve &

# Linux/Docker
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull nomic-embed-text

# Indexa con ollama directamente
PALACE_EMBED_PROVIDER=ollama node_modules/.bin/nexo-palace index
```

### Offline (sin red)

Si no hay litert ni ollama corriendo, se usa hash-TF-IDF determinista sin conexión a internet. Solo BM25 léxico, sin comprensión semántica real:

```bash
PALACE_EMBED_PROVIDER=offline node_modules/.bin/nexo-palace index
```

## Configuración del proyecto

Cada proyecto declara qué se indexa en un `nexo-palace.config.json` en su raíz:

```json
{
  "projectName": "mi-proyecto",

  "docs": ["docs"],
  "tasteDirs": [".commandcode/taste"],

  "codeDirs": ["app", "components", "lib", "tests", "e2e"],
  "codeExtensions": [".ts", ".tsx", ".js", ".jsx"],

  "requirementPrefixes": ["EPC", "US", "ADR"],

  "decisionsFile": ".commandcode/taste/decisions.md",
  "dbPath": ".nexo-palace/memory.sqlite3",

  "ignoreDirs": ["node_modules", ".git", ".next", "dist"]
}
```

| Clave | Para qué sirve | Por defecto |
| :--- | :--- | :--- |
| `projectName` | Nombre del proyecto en las descripciones del servidor MCP. | El nombre de la carpeta. |
| `docs` | Directorios cuyo Markdown se indexa como documentación. | `["docs"]` |
| `tasteDirs` | Directorios documentales marcados como `taste` (convenciones). | `[]` |
| `codeDirs` | Directorios escaneados por el extractor AST. | `["src", "lib", "app", "components", "tests", "test", "e2e"]` |
| `codeExtensions` | Extensiones de código indexables. | `[".ts", ".tsx", ".js", ".jsx"]` |
| `requirementPrefixes` | Prefijos de los IDs de trazabilidad (`EPC-01`, `US-101`…). | `["EPC", "US", "ADR", "REQ", "TASK", "WP"]` |
| `decisionsFile` | Dónde se acumulan las decisiones registradas. | `.nexo-palace/decisions.md` |
| `dbPath` | Ruta de la base SQLite. | `.nexo-palace/memory.sqlite3` |
| `ignoreDirs` | Directorios que nunca se recorren. | Una lista estándar de build. |

El fichero se busca **hacia arriba** desde el directorio actual, de modo que
funciona desde cualquier subcarpeta del proyecto.

> Todos los campos son opcionales: sin fichero de configuración, el motor usa
> los valores por defecto y funciona en el directorio actual.

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
