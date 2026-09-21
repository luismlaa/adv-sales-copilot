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
- [x] 58 pruebas en verde + typecheck estricto limpio + `next build` compila
- [x] Prueba SQL de no-cruce entre tenants (escrita; **falta correrla** — ver S-2)
- [x] Tres defectos de lo entregado, corregidos: adjunto sin asentar en el expediente,
      columna `telefono_wa` que mentía, y remitente de WhatsApp mono-tenant

## Pendientes

**El inventario completo vive en [`docs/PENDIENTES.md`](../docs/PENDIENTES.md)** — bloqueantes,
decisiones de Luis, runbook de onboarding, deuda técnica y orden sugerido. Este archivo no lo
duplica: solo lleva lo que está en curso ahora mismo.

### En curso

_(nada en curso — el siguiente arranque toma de `docs/PENDIENTES.md`)_

### Lo inmediato, si hay que elegir tres

1. **P0-4 · Meta** — es el camino crítico y corre en calendario, no en horas de trabajo. Arranca hoy.
2. **P0-1 · Auth del dealer** — sin sesión el Kanban se ve en blanco; hoy el panel es indemostrable.
3. **D-1 · Enmienda H7** — decisión tuya; bloquea H-SEC y por tanto el go-live.

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
