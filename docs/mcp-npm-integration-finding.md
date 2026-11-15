# Hallazgo de Arquitectura y DX: Configuración del Servidor MCP para Usuarios de NPM

**Fecha:** 15 de Noviembre de 2026  
**Módulo:** Integración MCP (`src/server.ts`, `src/installer.ts`, configuraciones de clientes)  
**Registro de Decisión:** `decision:2026-11-15T08-05-02-376Z` en [docs/decisions.md](file:///Users/jonathanquishpe/JoniDev/JonyDevProjects/nexo-palace/docs/decisions.md)

---

## 1. El Problema Detectado (Hallazgo)

Durante el desarrollo local, es habitual registrar el servidor MCP utilizando rutas absolutas o relativas al código fuente del repositorio, por ejemplo:

```bash
# ⚠️ Configuración atada al entorno de desarrollo local:
agy mcp add nexo-palace node --arg="--experimental-strip-types" --arg="/Users/.../nexo-palace/src/server.ts"
```

### Por qué esto falla para el usuario final de NPM:
1. **Inexistencia de código fuente:** Un usuario que instala el paquete vía `npm install -g @ijonydev/nexo-palace` o lo ejecuta mediante `npx @ijonydev/nexo-palace` **no tiene** el directorio `src/` en su máquina ni en su proyecto.
2. **Falta de portabilidad:** Una ruta absoluta (`/Users/jonathanquishpe/...`) rompe de inmediato en cualquier otra máquina o sistema operativo (Windows, Linux, CI/CD).
3. **Falsa sensación de disponibilidad:** Si el archivo `.agents/plugins/nexo-palace/mcp_config.json` se distribuye con comandos internos de desarrollo (`src/server.ts`), el arnés del agente intentará arrancarlo y fallará silenciosamente si el cliente no está en el repo de origen.

---

## 2. Solución Estándar para Usuarios Finales de NPM

El paquete publicado en NPM ya expone los binarios `nexo-palace` y `nxpl` a través de `bin/nexo-palace.js`, el cual incluye el subcomando **`serve`** (que arranca el servidor MCP stdio de `src/server.ts` directamente).

Por tanto, la configuración oficial y universal para cualquier cliente MCP debe ser **zero-config y basada en el comando publicado**:

### A. Para Claude Desktop / Cursor / VSCode (`mcpServers`)
```json
{
  "mcpServers": {
    "nexo-palace": {
      "command": "npx",
      "args": [
        "-y",
        "@ijonydev/nexo-palace",
        "serve"
      ]
    }
  }
}
```
*Si el usuario lo instaló globalmente (`npm install -g @ijonydev/nexo-palace`), puede usar directamente:*
```json
{
  "mcpServers": {
    "nexo-palace": {
      "command": "nxpl",
      "args": ["serve"]
    }
  }
}
```

### B. Para Google Antigravity (`agy`)
El comando de registro universal sin dependencias de rutas locales es:
```bash
agy mcp add nexo-palace npx --arg="-y" --arg="@ijonydev/nexo-palace" --arg="serve"
```

---

## 3. Plan de Acción en el Código de Nexo-Palace

Para garantizar que el usuario tenga el servidor MCP integrado y listo desde el momento de la instalación, se deben implementar las siguientes mejoras en el instalador:

1. **Auto-registro opcional en el Asistente (`src/installer.ts`):**
   - Tras seleccionar el proveedor de embeddings y cartografiar el proyecto, el asistente debe preguntar:
     *«¿Deseas registrar automáticamente Nexo-Palace como servidor MCP en tus clientes instalados (Claude Desktop, Cursor, Antigravity)?»*
   - Detectar si `agy` o los archivos `claude_desktop_config.json` existen en el sistema del usuario y añadir la entrada `npx -y @ijonydev/nexo-palace serve` de forma atómica.
2. **Actualización de Documentación:**
   - Reflejar en `README.md` y `README.en.md` que la integración MCP siempre debe apuntar al comando `npx -y @ijonydev/nexo-palace serve` o `nxpl serve`.
