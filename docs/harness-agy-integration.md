# Guía de Integración: Nexo-Palace en Google Antigravity (`agy`)

**Fecha:** 14 de Noviembre de 2026  
**Ámbito:** Plugin de Workspace Local (Scoped)  
**Harness / CLI:** `agy` (Google Antigravity)  

---

## 1. Motivación y Arquitectura

Cuando trabajamos con agentes autónomos en `agy` (Antigravity), registrar herramientas MCP en la configuración global de la máquina (`~/.gemini/config/mcp_config.json`) presenta desventajas:
- Provoca colisiones de nombres o herramientas innecesarias en otros proyectos.
- Exige rutas absolutas fijas que no son portables entre miembros del equipo.
- Requiere permisos elevados o manuales sobre el entorno global.

Para solucionar esto, aprovechamos el **sistema de plugins de workspace** nativo de Antigravity (`.agents/plugins/<nombre>/`). De esta forma, el servidor MCP y las reglas de memoria activa solo se activan cuando el agente opera dentro de este repositorio.

---

## 2. Estructura Implementada

```text
.agents/plugins/nexo-palace/
├── plugin.json         # Manifiesto del plugin scoped para el workspace
├── mcp_config.json     # Servidor MCP stdio ejecutado con Node nativo
└── rules/
    └── AGENTS.md       # Directivas de consulta y registro para el agente
```

---

## 3. Especificación de los Archivos

### A. Manifiesto del Plugin (`.agents/plugins/nexo-palace/plugin.json`)
Declara el paquete como plugin habilitado por defecto en este proyecto:
```json
{
  "name": "nexo-palace",
  "description": "Memoria activa de proyecto e índice semántico para este repositorio",
  "version": "0.1.0"
}
```

### B. Configuración MCP (`.agents/plugins/nexo-palace/mcp_config.json`)
Ejecuta el servidor MCP directamente desde el código TypeScript sin pasos de compilación previos (aprovechando Node `>= 22.6.0`):
```json
{
  "mcpServers": {
    "nexo-palace": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "src/server.ts"
      ]
    }
  }
}
```

### C. Directivas de Memoria Activa (`.agents/plugins/nexo-palace/rules/AGENTS.md`)
Regla inyectada en el prompt del sistema del agente para que consulte el índice antes de escribir código:
```markdown
# Nexo-Palace: Memoria Activa y Trazabilidad del Proyecto

Este proyecto cuenta con el servidor MCP `nexo-palace` configurado para consultar requisitos, arquitectura y convenciones.

## Directivas para el Agente:
1. **Antes de implementar o refactorizar código:**
   - Usa `memory_query` con el contexto o palabras clave de la tarea para verificar si existen requisitos (`RF-xx`, `US-xx`), decisiones previas o convenciones que apliquen.
   - Usa `memory_trace` pasando la ruta de archivos clave (ej. `src/server.ts`) para ver sus dependencias, tests vinculados y requisitos implementados.

2. **Registro de decisiones clave:**
   - Si introduces un cambio arquitectónico o tomas una decisión técnica de diseño importante, usa `memory_record_decision` para persistirla en la memoria del proyecto.

3. **Verificación:**
   - Puedes comprobar el estado del índice y número de fragmentos con `memory_status`.
```

---

## 4. Validación Realizada

1. **Protocolo MCP stdio:** Conexión cliente-servidor verificada con `@modelcontextprotocol/sdk`.
2. **Herramientas validadas:**
   - `memory_status`: Estado e introspección de nodos (117 nodos, 177 aristas, vectores en SQLite).
   - `memory_query`: Búsqueda híbrida y recuperación léxico-semántica.
   - `memory_trace`: Subgrafo de dependencias y símbolos AST.
   - `memory_record_decision`: Persistencia atómica de decisiones arquitectónicas en `docs/decisions.md` y en el grafo SQLite.
