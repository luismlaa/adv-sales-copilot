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

- [x] Dealer de ejemplo (`npm run db:seed-demo`) + login del dealer — verificado contra Supabase local
- [x] Fix: `pedirDocumentos` fallaba siempre (upsert contra índice parcial)
- [x] D-1: enmienda redactada en `docs/decisiones/D-1-enmienda-h7.md` (falta aplicarla en `advantio/`)
- [x] P0-2: proyecto de Supabase creado y migración aplicada (Luis, 2026-09-23)
- [x] P0-3: seed corrido en el proyecto real (verificado 2026-09-23)
- [x] P0-6: bucket privado `expedientes` creado (verificado 2026-09-23)
- [ ] S-2: correr la prueba de no-cruce contra el proyecto real
- [x] D-2: WABA por dealer (B) + cobro (1), 2026-09-23. A se descartó por el *display name*
- [ ] D-3: almacén de tokens por dealer (reabierto; el piloto usa `.env`)
- [ ] Luis: reescribir §4 del brief (Meta le cobra al dealer; Advantio cobra el software)
- [ ] Decisión de producto: ¿el comprador de contado salta el semáforo? (la *temperatura* ya la decidió Luis el 2026-09-24: contado = caliente siempre)

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

## Correcciones de la revisión del PR #1 — 2026-09-24

Hallazgos de la revisión independiente (`/code-review feat/dealer-demo-y-login high`).

- [x] **R-1 · `ports.ts:180` (medio/alto)** — `pedirDocumentos` inserta en lote y se traga `23505`; un choque concurrente descarta el INSERT completo y el copiloto afirma haber pedido documentos que no tienen casilla. Insertar fila por fila.
- [x] **R-2 · `ports.ts:166` (bajo)** — el chequeo de "ya pedido" ignora `estado`, así que un documento `rechazado` o `borrado` no se puede re-pedir. `estado` NO entra en el índice único: hay que **reciclar la fila** a `pendiente`, no insertar otra.
- [x] **R-3 · `kanban/page.tsx:52`** — `maybeSingle()` sobre `tenants` sin filtro revienta con `PGRST116` si el usuario pertenece a dos dealers, y el tablero mezcla leads de ambos. Resolver explícitamente y negarse a mostrar datos ambiguos.
- [x] **R-4 · `middleware.ts:43`** — la puerta autentica pero no autoriza; con `enable_signup = true` un desconocido entra al shell. Estado explícito de "sin acceso" + cerrar el registro abierto.
- [x] **R-5 · `login/actions.ts:15`** — el cliente se traga el fallo de escritura de cookie, así que el login puede "tener éxito" sin sesión. Cliente propio del flujo de auth que deja reventar.
- [x] **R-6 · `seed-demo.ts:290`** — la demo muestra `temperatura` derivada de un semáforo que no se guarda: el curioso sale tibio y la compradora real fría.
- [x] **R-7 · `seed-demo.ts:303`** — los dos `delete` de reset no se verifican; duplican historial o abortan a medio sembrar.
- [x] **R-8 · `seed-demo.ts:173`** — sin guarda contra correr el seed en producción con la service role key.

### Revisión de las correcciones

Verificación: `npx tsc --noEmit` limpio · `npx vitest run` 58/58 · `npx next build` compila · guarda del
seed probada con host remoto, con y sin `SEED_CONFIRM` (se niega y sale con código 1).
ESLint no está configurado en el proyecto: `next lint` abre el asistente. Queda como deuda aparte.

Tres correcciones **no** se hicieron como las propuso el revisor, porque su arreglo no funcionaba:

- **R-2** — proponía filtrar el chequeo por `estado`. Pero `lead_documents_tipo_uniq` es
  `(tenant_id, lead_id, tipo)` y **`estado` no entra**: insertar una segunda fila choca con el índice,
  da `23505` y se traga igual. Se recicla la fila existente a `pendiente`.
- **R-5** — proponía confirmar con `getUser()` tras el login. No sirve: el cliente ya tiene el token en
  memoria, así que `getUser()` responde OK aunque la cookie no se haya escrito. Se atacó la causa: un
  `authClient()` propio del flujo de auth que deja reventar la escritura.
- **R-4** — proponía chequear la membresía en el middleware. Eso mete un query a la base en cada
  request del edge. Se resolvió donde ya se conocía la respuesta: el tablero rinde un estado explícito
  de "sin acceso", y se cerró `enable_signup` en la config local.

Dos cosas quedan abiertas, y son de Luis:

- **Temperatura del comprador de contado (R-6) — resuelta por Luis el 2026-09-24.** El contado entra
  `caliente` siempre, independientemente de la fase, porque no tiene que someterse a que una institución
  financiera le apruebe crédito. La regla vive en `temperaturaDe()` (dominio, no en el seed), con
  `formaPago` como parámetro obligatorio para que nadie se la salte por olvido, y tres tests que la fijan
  — incluido uno de orden: el contado nunca queda por debajo del mejor caso de quien financia. `indeciso`
  sigue la regla de financiamiento, así que el curioso todavía puede salir frío. Queda abierto si el
  contado debe además saltarse el semáforo (ver `docs/PENDIENTES.md`).
- **Binario huérfano al re-pedir un documento.** Al reciclar una fila `rechazado` a `pendiente` se
  conserva el `storage_path` viejo; el índice de retención solo mira `estado = 'recibido'`, así que ese
  archivo queda fuera del barrido. Es trabajo del job de retención (S-3), no se improvisó aquí.
