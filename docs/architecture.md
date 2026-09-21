# Arquitectura — Sales Copilot

Decisiones y sus porqués. Lo que no está aquí está en la memoria de proyecto
(`~/.claude/projects/C--Users-LUIS-adv-sales-copilot/memory/`).

## 1. Fronteras

| Capa | Dónde | Responsabilidad |
|---|---|---|
| Entrada | `src/app/api/` | Validar firma, responder rápido, no pensar |
| Orquestación | `src/orchestrator/` | Resolver tenant, idempotencia, ventana, consumo |
| Agente | `src/agent/` | Un turno de conversación y su bucle de herramientas |
| Dominio | `src/domain/` | Código puro: semáforo, ventana de 24h, reparto de consumo |
| Conectores | `src/connectors/` | Supabase y WhatsApp. Lo único que toca la red |
| Contratos | `src/schemas/` | zod en cada frontera de módulo |

`src/domain/` no importa nada de `src/connectors/` ni del SDK de Anthropic. Esa
dirección de dependencia es lo que hace que las reglas de negocio se prueben sin
infraestructura — las 49 pruebas corren sin red, sin base y sin API key.

## 2. El modelo no decide el crédito

Dos capas, no una:

1. **Prompt** — el system prompt dice explícitamente que no decide, y la
   descripción de `evaluar_precalificacion` lo repite.
2. **Código** — `src/domain/prequalification.ts` calcula el semáforo. La
   herramienta devuelve el veredicto ya cerrado; el modelo solo lo transmite.

Una sola capa no alcanza: un prompt se puede alucinar, y una regla enterrada en
código sin decirlo produce respuestas que contradicen al sistema. Por eso están
las dos, y por eso `tests/unit/tool-contracts.test.ts` verifica que la
descripción siga diciéndolo.

El payload que devuelve la herramienta lleva siempre el campo `aviso` con el
texto fijo de que no es una decisión de crédito. Es un `z.literal`, así que no
se puede omitir por accidente.

## 3. Aislamiento: el motor, no la aplicación

`tenant_id NOT NULL` en toda tabla de negocio, RLS **`force`** (ni el dueño de
la tabla la evade) y una política por tabla que filtra con `auth_has_tenant()`.

Consecuencias prácticas:

- El Kanban (`src/app/(dealer)/kanban/page.tsx`) no lleva ni un
  `.eq("tenant_id", …)`. Si lo necesitara, sería señal de que la política no
  está haciendo su trabajo.
- `SUPABASE_SERVICE_ROLE_KEY` **salta RLS por diseño**. Solo la usan el webhook
  y los jobs, donde no hay usuario que autenticar, y siempre filtrando por
  tenant a mano. `asegurarTenant()` existe para que ese filtro sea explícito y
  revisable en el diff.
- `supabase/tests/no-cruce-entre-tenants.sql` prueba las dos direcciones —
  lectura y escritura — más el intento de insertar bajo un tenant ajeno. Es
  evidencia obligatoria de H-SEC.

Los documentos de identidad no viven en Postgres: solo el puntero a Storage, con
`retener_hasta` obligatorio y trazabilidad del borrado.

## 4. Caching: dónde está el corte y por qué

La caché de Anthropic es un match de prefijo, y el orden de render es
`tools` → `system` → `messages`. De ahí el diseño:

```
tools          [5 definiciones, orden fijo]  ← cache_control en la última
system[0]      cuerpo estable del prompt     ← cache_control
system[1]      bloque del dealer             ← volátil, después del corte
messages       historial + turno             ← volátil
```

El cuerpo del prompt es **idéntico para todos los dealers** a propósito: el
nombre, el horario y los documentos exigidos van en `system[1]`, después del
breakpoint. Si estuvieran arriba, cada dealer pagaría su propia escritura de
caché y no habría reutilización entre conversaciones de dealers distintos.

Dos cosas que rompen esto en silencio y por eso tienen prueba:

- Reordenar `TOOLS` → invalida la caché de todas las conversaciones vivas.
- Meter un timestamp o un id por request en el cuerpo estable.

`tasaCache()` en `src/agent/client.ts` se registra en cada turno. Si da 0 en
turnos consecutivos, hay un invalidador silencioso.

**Prohibida la cascada Haiku→Sonnet.** Las cachés son model-scoped: la cascada
pierde la reutilización, que vale ~30% de la entrada. Si Haiku no alcanza, la
vía es `claude-sonnet-5` a `effort: low`, medido antes de cambiar.

## 5. Diseñar para entrante

Meta no cobra las respuestas dentro de la ventana de 24h que abre el cliente; sí
cobra todo lo que iniciamos. `src/domain/conversation-window.ts` es la única
autoridad sobre eso, y `handle-inbound` la consulta antes de cada salida: si la
ventana cerró mientras corría el turno, **no responde** en vez de facturar una
plantilla sin decisión humana.

## 6. Idempotencia

Tres claves, tres niveles:

| Qué | Clave | Qué evita |
|---|---|---|
| Mensaje entrante | `messages(tenant_id, wa_message_id)` | Que un reintento de Meta procese dos veces |
| Evento facturable | `usage_events(tenant_id, contador, idempotency_key)` | Cobrar dos veces la misma conversación |
| Fila de inventario | `vehicles(tenant_id, stock_id)` | Que re-subir el CSV duplique el inventario |

El código trata el error `23505` de Postgres como el resultado correcto, no como
un fallo: significa que la protección funcionó.

## 7. Consumo

`usage_events` es un ledger inmutable; un trigger mantiene el agregado
`usage_counters`. Una sola vía de escritura, y el dealer no puede tocar ninguna
de las dos (`revoke`): que pudiera editarlas sería editar su propia factura.

`repartirConsumo()` implementa la regla de cobro — base, luego paquetes en orden
de compra, luego excedente — como función pura, para poder probarla sin base.

## 8. Lo que queda abierto

| # | Abierto | Impacto |
|---|---|---|
| 1 | Lectura de documentos por visión | Hoy solo se almacenan. Si se leen, es ruta de dato regulado: medir Haiku vs Sonnet 5 en extracción de cédula antes de elegir |
| 2 | Tarifas de WhatsApp cambian el 2026-10-01 | Revalidar costo unitario después de esa fecha |
| 3 | Costo unitario sin calibrar | Falta medir una conversación real contra la API: turnos, tokens de entrada y salida |
| 4 | Choque H7 multi-tenant vs H-DATA | Documentos rectores de Advantio sin enmendar. Bloquea H-SEC |
| 5 | Ley 172-13 de protección de datos de RD | Alcance por verificar |
