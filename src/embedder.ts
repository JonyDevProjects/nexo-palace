/**
 * Nexo-Palace Engine — proveedores de embeddings.
 *
 * El motor no fija un único proveedor: la capa de vectores es enchufable para
 * que el mismo índice sirva tanto en desarrollo local (sin red) como con un
 * proveedor remoto de mayor calidad.
 *
 * Proveedores soportados:
 *   * `gemini`  — `text-embedding-004` vía API de Google (requiere GEMINI_API_KEY).
 *   * `ollama`  — modelos de embedding servidos por Ollama (`/api/embed`).
 *   * `offline` — hash-TF-IDF determinista, sin red y sin dependencias.
 *
 * El proveedor `offline` no produce vectores semánticos reales: produce
 * vectores léxicos (proximidad por solapamiento de términos con peso IDF).
 * Sirve para que el motor sea operable y verificable de inmediato, y el motor
 * lo registra en `meta.embedding_provider` para que la diferencia sea visible
 * en lugar de silenciosa.
 */
import { OFFLINE_EMBEDDING_DIM, PROVIDER_DIMS } from "./config.ts";

/** Interfaz común de todo proveedor de embeddings. */
export interface EmbeddingProvider {
  /** Identificador `proveedor:modelo`. */
  readonly name: string;
  /** Dimensión del vector produced. */
  readonly dim: number;
  /** Genera embeddings para un lote de textos. */
  embed(texts: string[]): Promise<Float32Array[]>;
  /**
   * Prepara el corpus de referencia (solo lo usa el proveedor offline, que
   * necesita las frecuencias de documento para calcular el IDF).
   */
  prepareCorpus?(texts: string[]): void;
}

/** Opciones de construcción del proveedor. */
export interface ProviderOptions {
  /** Fuerza un proveedor concreto. */
  provider?: string;
  /** Modelo a usar dentro del proveedor. */
  model?: string;
  /** Clave de la API de Gemini. */
  apiKey?: string;
  /** URL base de Ollama. */
  baseUrl?: string;
  /** Dimensión para el proveedor offline. */
  dim?: number;
}

// -----------------------------------------------------------------------------
// Tokenización compartida
// -----------------------------------------------------------------------------

/** Palabras vacías frecuentes en español e inglés. */
const STOPWORDS = new Set(
  `de la que el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra tanto esa estos mucho quienes nada muchos cual sea poco ella estar haber estas estaba estamos algunas algo nosotros
the a an and or but if then else of in on at to for with by from as is are was were be been being it its this that these those there here we you they he she i not no so do does did done have has had will would can could should may might must about into over under after before again more most other some such only own same too very just also here when where why how all any both each few nor own s t don now
`.split(/\s+/),
);

/** Divide un identificador CamelCase en sus partes. */
function splitCamel(token: string): string[] {
  return token.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/);
}

/**
 * Tokeniza texto en términos normalizados.
 * Conserva identificadores (se parten por CamelCase) y códigos con guion
 * (`EPC-01` → `epc-01`, `epc`, `01`).
 */
export function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const out: string[] = [];
  const rawTokens = normalized.match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/g) ?? [];

  for (const raw of rawTokens) {
    for (const piece of raw.split(/[-_]/)) {
      if (piece.length >= 2 && !STOPWORDS.has(piece)) out.push(piece);
    }
    for (const piece of splitCamel(raw)) {
      if (piece.length >= 3 && !STOPWORDS.has(piece) && piece !== raw) out.push(piece);
    }
    if (raw.includes("-") || raw.includes("_")) out.push(raw);
  }
  return out;
}

/** Normaliza un vector a norma unitaria (evita que el coseno diverja). */
function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / norm;
  return vec;
}

// -----------------------------------------------------------------------------
// Proveedor offline: hash-TF-IDF
// -----------------------------------------------------------------------------

/** Hash FNV-1a de 32 bits. */
function fnv1a(str: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Proveedor determinista sin red.
 * Cada término se proyecta en dos cubos con signo (hashing trick), de forma
 * que la similitud del coseno aproxima el solapamiento ponderado por IDF.
 */
export class OfflineEmbeddingProvider implements EmbeddingProvider {
  readonly name = "offline:hash-tfidf";
  readonly dim: number;
  private df: Map<string, number> = new Map();
  private corpusSize = 0;

  constructor(dim: number = OFFLINE_EMBEDDING_DIM) {
    this.dim = dim;
  }

  prepareCorpus(texts: string[]): void {
    this.df = new Map();
    this.corpusSize = texts.length;
    for (const text of texts) {
      const unique = new Set(tokenize(text));
      for (const token of unique) {
        this.df.set(token, (this.df.get(token) ?? 0) + 1);
      }
    }
  }

  private idf(token: string): number {
    if (this.corpusSize === 0) return 1;
    const df = this.df.get(token) ?? 0;
    return Math.log((this.corpusSize + 1) / (df + 1)) + 1;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vec = new Float32Array(this.dim);
      const tf = new Map<string, number>();
      for (const token of tokenize(text)) tf.set(token, (tf.get(token) ?? 0) + 1);

      for (const [token, count] of tf) {
        const weight = (1 + Math.log(count)) * this.idf(token);
        // Dos proyecciones con signo distinto reducen el sesgo por colisión.
        const h1 = fnv1a(token, 0x9e3779b9);
        const h2 = fnv1a(token, 0x85ebca6b);
        const i1 = h1 % this.dim;
        const i2 = h2 % this.dim;
        const s1 = h1 & 1 ? 1 : -1;
        const s2 = h2 & 1 ? 1 : -1;
        vec[i1] += weight * s1;
        vec[i2] += weight * s2;
      }
      return l2Normalize(vec);
    });
  }
}

// -----------------------------------------------------------------------------
// Proveedor Gemini
// -----------------------------------------------------------------------------

/**
 * Limitador de caudal compartido por todos los proveedores Gemini.
 *
 * El nivel gratuito permite 100 peticiones de `embedContent` por minuto y por
 * proyecto. Espaciar las peticiones evita el 429 en lugar de reintentar a
 * ciegas: con 620 ms entre llamadas se queda justo por debajo del límite.
 */
class RateLimiter {
  private nextSlot = 0;

  async acquire(minIntervalMs: number): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + minIntervalMs;
    const wait = slot - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** Limitador compartido entre instancias del proveedor. */
const geminiLimiter = new RateLimiter();

/**
 * Modelos de embedding de Gemini, en orden de preferencia.
 * El descubrimiento automático usa `ListModels`, porque no todas las claves
 * tienen provisionado el mismo catálogo.
 */
const GEMINI_EMBEDDING_PREFERENCE = [
  "gemini-embedding-001",
  "text-embedding-004",
  "gemini-embedding-2-preview",
];

/** Cliente de embeddings de Google Gemini. */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  private apiKey: string;
  private model: string;
  /** Milisegundos mínimos entre dos peticiones. */
  private minIntervalMs: number;

  constructor(apiKey: string, model = "gemini-embedding-001") {
    this.apiKey = apiKey;
    this.model = model;
    this.name = `gemini:${model}`;
    this.dim = PROVIDER_DIMS[this.name] ?? 768;
    this.minIntervalMs = Number(process.env.PALACE_EMBED_MIN_INTERVAL_MS || 620);
  }

  /**
   * Descubre qué modelo de embedding admite la clave.
   * Devuelve `null` si la clave no tiene ninguno provisionado.
   */
  static async discoverModel(apiKey: string): Promise<string | null> {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
      };
      const available = (json.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes("embedContent"))
        .map((m) => m.name.replace(/^models\//, ""));
      if (available.length === 0) return null;

      for (const preferred of GEMINI_EMBEDDING_PREFERENCE) {
        if (available.includes(preferred)) return preferred;
      }
      // Sin coincidencia: se prefiere la versión estable más reciente.
      const stable = available
        .filter((m) => !m.includes("preview") && !m.includes("experimental"))
        .sort();
      return stable[stable.length - 1] ?? available[0];
    } catch {
      return null;
    }
  }

  /**
   * Genera embeddings usando el endpoint individual `embedContent`.
   *
   * El endpoint por lotes (`batchEmbedContents`) tiene una cuota mucho más
   * restrictiva y devuelve HTTP 429 con las claves de nivel gratuito, así que
   * se usan peticiones individuales con concurrencia limitada y reintentos con
   * espera exponencial.
   */
  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = new Array(texts.length);
    const CONCURRENCY = 4;
    const MAX_RETRIES = 5;

    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        if (index >= texts.length) return;
        out[index] = await this.embedOne(texts[index], MAX_RETRIES);
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, () => worker()));
    return out;
  }

  /** Genera un único embedding, reintentando ante 429 y errores transitorios. */
  private async embedOne(text: string, maxRetries: number): Promise<Float32Array> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${encodeURIComponent(this.apiKey)}`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await geminiLimiter.acquire(this.minIntervalMs);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
            outputDimensionality: this.dim,
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (res.ok) {
          const json = (await res.json()) as { embedding?: { values: number[] } };
          const values = json.embedding?.values;
          if (!values || values.length === 0) {
            throw new Error(`Gemini devolvió un embedding vacío para ${this.model}.`);
          }
          const vec = new Float32Array(values.length);
          vec.set(values);
          return l2Normalize(vec);
        }

        const detail = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500;

        // Cuota diaria agotada: esperar dentro del mismo proceso no sirve,
        // porque la ventana se reinicia en minutos, no en segundos.
        if (res.status === 429 && /per day limit exceeded/i.test(detail)) {
          const hint = /Please retry in ([0-9.]+)s/.exec(detail);
          const waitMs = hint ? Math.ceil(Number(hint[1]) * 1000) : 0;
          const limit = /"quotaValue":\s*"(\d+)"/.exec(detail);
          const resetAt = new Date(Date.now() + waitMs);
          throw new Error(
            `Cuota diaria de embeddings de Gemini agotada` +
              `${limit ? ` (${limit[1]} peticiones/día)` : ""}. ` +
              `Se restablece sobre las ${resetAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} ` +
              `(${Math.round(waitMs / 60000)} min). ` +
              `Reindexa después: los fragmentos ya indexados conservan su vector.`,
          );
        }

        if (!retryable || attempt === maxRetries) {
          throw new Error(`Gemini embeddings HTTP ${res.status}: ${detail.slice(0, 300)}`);
        }
        // El servidor indica exactamente cuánto esperar: "Please retry in 3.4s".
        const hint = /Please retry in ([0-9.]+)s/.exec(detail);
        if (hint) {
          const hinted = Math.ceil(Number(hint[1]) * 1000);
          await new Promise((resolve) => setTimeout(resolve, hinted));
        }
      } catch (err) {
        // Los errores de red también son reintentables.
        const message = (err as Error).message;
        const isHttpError = message.startsWith("Gemini embeddings HTTP");
        if (isHttpError || attempt === maxRetries) throw err;
      }

      // Espera exponencial con un máximo de 8 s.
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)));
    }

    throw new Error(`No se pudo generar el embedding tras ${maxRetries + 1} intentos.`);
  }
}

// -----------------------------------------------------------------------------
// Proveedor Ollama
// -----------------------------------------------------------------------------

/** Cliente de embeddings de Ollama (`/api/embed`). */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model = "nomic-embed-text") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.name = `ollama:${model}`;
    this.dim = PROVIDER_DIMS[this.name] ?? 768;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama embeddings HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as { embeddings?: number[][] };
    const embeddings = json.embeddings ?? [];
    return embeddings.map((values) => {
      const vec = new Float32Array(values.length);
      vec.set(values);
      return l2Normalize(vec);
    });
  }
}

// -----------------------------------------------------------------------------
// Proveedor LiteRT (servicio local del proyecto)
// -----------------------------------------------------------------------------

/**
 * Cliente de embeddings del servicio LiteRT local (`scripts/litert-service.ts`).
 *
 * Expone `/v1/embeddings` con la misma forma que la API de OpenAI y delega
 * el cálculo en el motor de inferencia local (Ollama sobre Metal). Es la vía
 * que el proyecto ya usaba para visión y razonamiento, ahora ampliada a
 * embeddings.
 */
export class LiteRtEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model = "nomic-embed-text") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.name = `litert:${model}`;
    this.dim = PROVIDER_DIMS[this.name] ?? 768;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LiteRT embeddings HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const embeddings = json.data ?? [];
    return embeddings.map((entry) => {
      const vec = new Float32Array(entry.embedding.length);
      vec.set(entry.embedding);
      return l2Normalize(vec);
    });
  }
}

// -----------------------------------------------------------------------------
// Resolución del proveedor
// -----------------------------------------------------------------------------

/** Comprueba si el servicio LiteRT local responde. */
export async function litertAvailable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Comprueba si Ollama responde. */
export async function ollamaAvailable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Comprueba que un proveedor realmente funciona, con una única petición mínima.
 * Existe porque una clave de API presente pero inválida no debe llevar al
 * motor a un estado degradado silencioso.
 */
export async function providerWorks(provider: EmbeddingProvider): Promise<boolean> {
  try {
    const vectors = await provider.embed(["nexo health check"]);
    return vectors.length === 1 && vectors[0].length > 0;
  } catch {
    return false;
  }
}

/**
 * Construye el proveedor de embeddings según el entorno.
 *
 * Orden de resolución en modo `auto`:
 *   1. Gemini si hay `GEMINI_API_KEY` **y la clave responde**.
 *   2. Ollama si el daemon responde.
 *   3. Offline (siempre disponible).
 *
 * Un proveedor explícito que falla NO degrada de forma silenciosa: lanza, para
 * que el error sea visible en lugar de producir un índice incorrecto.
 */
export async function createEmbeddingProvider(options: ProviderOptions = {}): Promise<EmbeddingProvider> {
  const requested = (options.provider || process.env.PALACE_EMBED_PROVIDER || "auto").toLowerCase();
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
  const baseUrl = options.baseUrl || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = options.model || process.env.PALACE_EMBED_MODEL || "";

  if (requested === "gemini") {
    if (!apiKey) throw new Error("Proveedor 'gemini' requiere GEMINI_API_KEY.");
    const resolved = model || (await GeminiEmbeddingProvider.discoverModel(apiKey));
    if (!resolved) {
      throw new Error(
        "La clave de Gemini no tiene ningún modelo de embedding provisionado " +
          "(comprueba ListModels para esta clave).",
      );
    }
    return new GeminiEmbeddingProvider(apiKey, resolved);
  }

  if (requested === "ollama" || requested === "local") {
    if (!(await ollamaAvailable(baseUrl))) {
      throw new Error(`Proveedor 'ollama' no disponible en ${baseUrl}.`);
    }
    return new OllamaEmbeddingProvider(baseUrl, model || "nomic-embed-text");
  }

  if (requested === "litert" || requested === "lite") {
    const litertUrl = options.baseUrl || process.env.LITERT_EMBED_URL || "http://127.0.0.1:11435";
    if (!(await litertAvailable(litertUrl))) {
      throw new Error(
        `Proveedor 'litert' no disponible en ${litertUrl}. ` +
          `Arranca el servicio con 'npm run litert:serve'.`,
      );
    }
    return new LiteRtEmbeddingProvider(
      litertUrl,
      model || process.env.LITERT_EMBEDDING_MODEL || "nomic-embed-text",
    );
  }

  if (requested === "offline" || requested === "hash") {
    const dim = options.dim ?? OFFLINE_EMBEDDING_DIM;
    return new OfflineEmbeddingProvider(dim);
  }

  if (requested === "auto") {
    // 1. LiteRT local: es el motor que ya usa el proyecto, no consume cuota
    //    remota y responde en milisegundos. Medido frente a Gemini Embedding
    //    2, empata en precisión (top-1) con una latencia ~23 veces menor.
    const litertUrl = process.env.LITERT_EMBED_URL || "http://127.0.0.1:11435";
    if (await litertAvailable(litertUrl)) {
      return new LiteRtEmbeddingProvider(
        litertUrl,
        model || process.env.LITERT_EMBEDDING_MODEL || "nomic-embed-text",
      );
    }

    // 2. Gemini: mejor cobertura en top-5, pero con cuota diaria limitada.
    if (apiKey) {
      const resolved = model || (await GeminiEmbeddingProvider.discoverModel(apiKey));
      if (resolved) {
        const gemini = new GeminiEmbeddingProvider(apiKey, resolved);
        if (await providerWorks(gemini)) return gemini;
      }
      process.stderr.write(
        "[nexo-palace] La clave de Gemini no permite embeddings (o no hay red): " +
          "se continúa con el proveedor local.\n",
      );
    }

    // 3. Ollama directo, si el daemon está en marcha.
    if (await ollamaAvailable(baseUrl)) {
      return new OllamaEmbeddingProvider(baseUrl, model || "nomic-embed-text");
    }

    // 4. Siempre hay un proveedor: el léxico sin red.
    return new OfflineEmbeddingProvider(options.dim ?? OFFLINE_EMBEDDING_DIM);
  }

  throw new Error(`Proveedor de embeddings desconocido: '${requested}'.`);
}

/**
 * Reconstruye el proveedor con el que se construyó el índice.
 *
 * Es importante para las consultas: si el índice tiene vectores de 768
 * dimensiones de Gemini y la búsqueda usa vectores de 384 de otro proveedor,
 * la distancia coseno no es comparable y el resultado sería incorrecto. Si el
 * proveedor ya no está disponible (por ejemplo, cuota agotada), la búsqueda
 * vectorial se desactiva y la léxica sigue funcionando.
 */
export function providerFromId(id: string | null, dim: number | null): EmbeddingProvider | null {
  if (!id) return null;
  const [kind, ...rest] = id.split(":");
  const model = rest.join(":");

  switch (kind) {
    case "gemini":
      if (!process.env.GEMINI_API_KEY) return null;
      return new GeminiEmbeddingProvider(process.env.GEMINI_API_KEY, model);
    case "ollama":
      return new OllamaEmbeddingProvider(
        process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
        model,
      );
    case "litert":
      return new LiteRtEmbeddingProvider(
        process.env.LITERT_EMBED_URL || "http://127.0.0.1:11435",
        model,
      );
    case "offline":
      return new OfflineEmbeddingProvider(dim ?? OFFLINE_EMBEDDING_DIM);
    default:
      return null;
  }
}

/** Describe el proveedor en texto plano (para logs y para `meta`). */
export function describeProvider(provider: EmbeddingProvider): string {
  if (provider instanceof OfflineEmbeddingProvider) {
    return `${provider.name} (vectores léxicos, sin semántica real — define GEMINI_API_KEY o enciende Ollama para búsqueda semántica)`;
  }
  return `${provider.name} (dim ${provider.dim})`;
}
