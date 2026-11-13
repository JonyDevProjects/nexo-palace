/**
 * Nexo-Palace — configuración post-instalación de embeddings locales.
 *
 * Se ejecuta automáticamente tras npm install (postinstall). Detecta servicios
 * locales disponibles y muestra recomendaciones para habilitar búsqueda semántica real.
 *
 * Prioridad: litert > ollama > offline
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = process.cwd();
const CONFIG_PATH = join(PROJECT_ROOT, "nexo-palace.config.json");
const ENV_PATH = join(PROJECT_ROOT, ".env");

interface ProviderInfo {
  name: string;
  available: boolean;
  installed?: boolean;
  installCommand?: string;
  dim: number;
  model: string;
}

async function checkProvider(name: string, url: string, modelCheck?: string): Promise<ProviderInfo> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { name, available: false, dim: 768, model: "" };

    let info: ProviderInfo;

    if (name === "litert") {
      // litert expone /v1/models
      const modelsRes = await res.json() as { data?: Array<{ id: string }> };
      const hasNomic = modelsRes.data?.some((m) => m.id.includes("nomic"));
      info = {
        name: "litert",
        available: true,
        dim: 768,
        model: hasNomic ? "nomic-embed-text" : "",
      };
    } else {
      // ollama expone /api/tags con modelo embed disponible
      const tagsRes = await res.json() as { models?: Array<{ name: string }> };
      const hasEmbed = tagsRes.models?.some((m) => m.name.includes("embed") || m.name.includes("nomic"));
      info = {
        name: "ollama",
        available: !!hasEmbed,
        dim: hasEmbed ? undefined as unknown as number : 768,
        model: "",
      };
    }
    return info;
  } catch {
    return { name, available: false, dim: 768, model: "" };
  }
}

function getProviderRecommendations(providerInfo: { litert: ProviderInfo; ollama: ProviderInfo }): string {
  const parts: string[] = [];

  if (providerInfo.litert.available && providerInfo.litert.model) {
    parts.push(
      "\n✅ LiteRT detectado en http://127.0.0.1:11435",
      `   Modelo: ${providerInfo.litert.model} (dim 768)`,
      "",
      "   Indexa ahora con:",
      "     PALACE_EMBED_PROVIDER=litert node_modules/.bin/nexo-palace index",
    );
  } else if (providerInfo.litert.available) {
    parts.push(
      "\n⚠️ LiteRT corriendo pero necesita modelo:",
      "     ollama pull nomic-embed-text",
      "   Luego reindexa con:",
      "     PALACE_EMBED_PROVIDER=litert node_modules/.bin/nexo-palace index",
    );
  } else {
    parts.push(
      "\n📦 Para usar litert (modelo embebido, sin servidor externo):",
      "",
      "   # Instalación vía pip:",
      "   pip install mlc-ai-litert",
      "",
      "   # Arrancar servicio en puerto 11435:",
      "   python -m litert.serve --port 11435",
      "",
      "   Descarga el modelo automáticamente la primera vez.",
    );
  }

  if (providerInfo.ollama.available) {
    parts.push(
      "\n✅ Ollama detectado en localhost:11434",
      "   Usa embeddings locales directamente sin servicio intermedio.",
      "",
      "   Indexa ahora con:",
      "     PALACE_EMBED_PROVIDER=ollama node_modules/.bin/nexo-palace index",
    );
  } else if (providerInfo.litert.available) {
    // Solo mostrar ollama recommendation si litert ya está activo
  } else {
    parts.push(
      "\n🐋 Alternativa: Ollama (más fácil, sin Python)",
      "",
      "   # macOS:",
      "   brew install ollama && ollama serve &",
      "   ollama pull nomic-embed-text",
      "",
      "   # Linux/Docker:",
      "   curl -fsSL https://ollama.ai/install.sh | sh",
      "   ollama pull nomic-embed-text",
      "",
      "   Ollama levanta un servicio local que responde a /api/embeddings.",
    );
  }

  return parts.join("\n");
}

async function main(): Promise<void> {
  console.log("\n🔍 Nexo-Palace — buscando proveedores de embeddings locales...");

  const [litert, ollama] = await Promise.all([
    checkProvider("litert", "http://127.0.0.1:11435/v1/models"),
    checkProvider("ollama", "http://localhost:11434/api/tags"),
  ]);

  // Seleccionar mejor provider disponible
  let selected: "litert" | "ollama" | "offline";
  if (litert.available) selected = "litert";
  else if (ollama.available) selected = "ollama";
  else selected = "offline";

  // Actualizar config si no hay provider explícito configurado
  const envProvider = process.env.PALACE_EMBED_PROVIDER;
  if (!envProvider) {
    const configContent = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : "{}";
    try {
      const config = JSON.parse(configContent);
      if (!config.PALACE_EMBED_PROVIDER) {
        config.PALACE_EMBED_PROVIDER = selected;
        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
      }
    } catch { /* config inválido, ignorar */ }
  }

  // Crear .env si no existe
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, "# Configuración local de Nexo-Palace\n", "utf8");
  }

  console.log(getProviderRecommendations({ litert, ollama }));

  if (selected === "offline") {
    console.log("\n⚠️ No se encontró litert ni Ollama.");
    console.log("   La indexación usará hash-TF-IDF (solo BM25 léxico, sin comprensión semántica).");
    console.log("   Para embebbidos reales semánticos, instala uno de estos:");
    console.log("   ");
    console.log("   # LiteRT (servicio standalone):");
    console.log("   pip install mlc-ai-litert && python -m litert.serve --port 11435");
    console.log("   ");
    console.log("   # Ollama (más sencillo):");
    console.log("   brew install ollama && ollama pull nomic-embed-text && ollama serve");
    console.log("");
  }

  console.log("🎉 Instalación completada.\n");
}

if (import.meta.url.endsWith(process.argv[1])) {
  main().catch(console.error);
}
