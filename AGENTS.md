# Memoria Activa del Proyecto (nexo-palace) — Nexo-Palace

Este repositorio utiliza el servidor MCP `nexo-palace` para consultar requisitos, arquitectura, trazabilidad y decisiones.
Antes de realizar exploraciones extensas con `find`/`grep` o leer múltiples archivos completos, sigue este protocolo:

## 1. Exploración (Antes de leer o editar código)
- Usa `memory_query({ query, scope?, limit?, pathPrefix? })` para localizar especificaciones, módulos clave y convenciones registradas (`docs/decisions.md`).
- Usa `memory_trace({ entity, depth? })` sobre los archivos o símbolos que vayas a modificar para revisar dependencias, tests vinculados y requisitos relacionados.
- Una vez localizados los archivos exactos, lee únicamente las líneas necesarias.

## 2. Registro de Decisiones
- Cuando adoptes un patrón arquitectónico, cambies un contrato público o resuelvas un bug complejo, invoca `memory_record_decision({ context, decision, tags?, relatedFiles? })`.

## 3. Sincronización y Cierre
- Tras editar código o documentación, ejecuta `memory_map({})` (o `npm run palace:map`) para mantener sincronizados el grafo AST y los embeddings.
- Antes de cerrar la tarea, ejecuta `memory_drift({ dryRun: true })` (o `npm run palace:drift`) para verificar si algún requisito vinculado requiere revisión.
- Usa `memory_status({})` (o `npm run palace:stats`) para confirmar que el servidor MCP apunta a la raíz correcta del proyecto.

## Convenciones del Repositorio
- Mantén importaciones relativas con extensión `.ts` explícita (`--experimental-strip-types`).
- Ejecuta `npm run typecheck`, `npm run test:unit`, `npm test` y `npm run build` antes de entregar cambios.
