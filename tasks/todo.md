# Plan — Sales Copilot

> Tracker local del repo. Las lecciones durables van a memoria de proyecto, no aquí.

## Hecho — andamiaje inicial (2026-09-20)

- [x] Esquema Supabase con `tenant_id` en toda tabla y RLS forzada
- [x] Contadores de consumo (`usage_events` + trigger a `usage_counters`) en la primera migración
- [x] Motor determinista de pre-calificación, sin red ni LLM
- [x] Herramientas con `strict: true` + `additionalProperties: false`
- [x] Prompt caching con el corte entre cuerpo estable y bloque del dealer
- [x] Ventana de 24h como única autoridad de salida
- [x] Webhook de WhatsApp con firma HMAC e idempotencia
- [x] Importación CSV/Excel con sinónimos de encabezado y errores por fila
- [x] Job nocturno por Batch API (50% menos)
- [x] Kanban del dealer apoyado en RLS
- [x] 49 pruebas en verde + typecheck estricto limpio
- [x] Prueba SQL de no-cruce entre tenants (evidencia de H-SEC)

## Siguiente — antes de la primera conversación real

- [ ] **Calibrar el costo unitario** — medir una conversación de calificación real contra la API: turnos, tokens de entrada y salida, tasa de caché. Es barato y convierte el costo de supuesto en dato. *(Paralelizable con subagente: correr el turno y reportar métricas.)*
- [ ] Auth del dealer (Supabase Auth) + middleware de sesión para `/kanban`
- [ ] Pantalla de importación de inventario (hoy solo existe el endpoint)
- [ ] Seed de un tenant de prueba con su ruleset vigente
- [ ] Plantillas de WhatsApp (utility y marketing) aprobadas en Meta + el envío que registra `usage_events`
- [ ] Job de retención: borrar documentos cuyo `retener_hasta` venció

## Bloqueado por decisión de Luis

- [ ] **H7 — multi-tenant vs H-DATA.** Los documentos rectores de Advantio (`CLAUDE.md`, `operacion/HARDSTOPS.md`) declaran deploy por cliente y aislamiento por instancia. Este producto es multi-tenant con RLS. Luis autorizó construir así; la enmienda no está aplicada y **bloquea H-SEC**.
- [ ] **Decisión abierta #1 — lectura de documentos por visión.** Hoy solo se almacenan. Si se leen, hay que medir Haiku vs Sonnet 5 en extracción de cédula antes de elegir modelo.
- [ ] Revalidar costo unitario después del **2026-10-01** (cambio de tarifas de Meta).
- [ ] Verificar alcance de la Ley 172-13 de protección de datos de RD.

## Revisión — 2026-09-20

El andamiaje traduce cada regla obligatoria del brief a un punto del sistema donde se puede verificar, no solo documentar:

| Regla del brief | Dónde vive | Cómo se verifica |
|---|---|---|
| `tenant_id` en toda tabla | `supabase/migrations/0001_init.sql` | `tests/smoke.test.ts` recorre cada `create table` |
| `strict: true` en toda herramienta | `src/agent/tools/definitions.ts` | `tests/unit/tool-contracts.test.ts` |
| Reglas como config, no prompt | `config/tenants/*.json` | `tests/unit/prequalification.test.ts` |
| El modelo no decide crédito | `src/domain/prequalification.ts` | Motor puro + prueba de que la descripción lo dice |
| Caching desde el día uno | `src/agent/run-turn.ts` | Corte probado + `tasaCache()` en cada log |
| Diseñar para entrante | `src/domain/conversation-window.ts` | `tests/unit/conversation-window.test.ts` |
| Contadores = factura | `usage_events` + trigger | `tests/unit/usage.test.ts` + prueba de humo |
| CSV/Excel día uno | `src/import/vehicles.ts` | `tests/unit/import-vehicles.test.ts` |
| Sin cruce entre dealers | RLS forzada | `supabase/tests/no-cruce-entre-tenants.sql` |

Lo que **no** está: autenticación del dealer, UI de importación, plantillas de WhatsApp y el job de retención. Ninguna de esas piezas cambia el modelo de datos, así que pueden entrar después sin migración destructiva.
