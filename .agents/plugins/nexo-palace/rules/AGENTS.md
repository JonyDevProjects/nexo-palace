# Nexo-Palace: Memoria Activa y Trazabilidad del Proyecto

Este proyecto cuenta con el servidor MCP `nexo-palace` configurado para consultar requisitos, arquitectura y convenciones.

## Directivas para el Agente:
1. **Antes de implementar o refactorizar código:**
   - Usa `memory_query` con el contexto o palabras clave de la tarea para verificar si existen requisitos (`RF-xx`, `US-xx`), decisiones previas o convenciones que apliquen.
   - Usa `memory_trace` pasando la ruta de archivos clave (ej. `src/server.ts`) para ver sus dependencias, tests vinculados y requisitos implementados.

2. **Registro de decisiones clave:**
   - Si introduces un cambio arquitectónico o tomas una decisión técnica de diseño importante, usa `memory_record_decision` para persistirla en la memoria del proyecto.

3. **Mapeo proactivo post-implementación:**
   - Tras completar cualquier refactorización, merge de ramas, o creación de nuevos documentos, especificaciones, tests o código, el agente DEBE ejecutar proactivamente `npm start -- map` (o `nxpl map`) para mantener el grafo de trazabilidad y los embeddings sincronizados de forma continua sin esperar a una orden manual.

4. **Verificación:**
   - Puedes comprobar el estado del índice y número de fragmentos con `memory_status` (o `npm start -- stats`).
