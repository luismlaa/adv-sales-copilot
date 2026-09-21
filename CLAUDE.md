# Sales Copilot

> Producto de catálogo multi-tenant para dealers de vehículos en RD. Recibe leads por WhatsApp, separa comprador de curioso, pre-califica el financiamiento contra las reglas del dealer y entrega al vendedor solo leads calientes con el expediente armado.
> Categoría: single-agent-app + web-app · Stack: TypeScript / Next.js · Anthropic `claude-haiku-4-5` · Supabase · Owner: Advantio (Luis)

---

## ⚡ Sistema operativo — Orquestación de trabajo

1. **Plan primero** — entra en modo plan para cualquier tarea no trivial (3+ pasos o decisión arquitectónica). Si algo se tuerce a media tarea, **para y replantea**; no empujes.
2. **Subagentes** — delega investigación y exploración a subagentes para mantener limpio el contexto principal. Una tarea por subagente.
3. **Bucle de mejora** — tras cualquier corrección del owner, captura el patrón como nota en memoria de proyecto y escribe la regla que evita repetirlo.
4. **Verificar antes de dar por hecho** — nunca marques algo completo sin prueba: `npm test`, `npx tsc --noEmit`, logs. Pregunta: *¿lo aprobaría un ingeniero senior?*
5. **Exigir elegancia (con medida)** — en cambios no triviales, pregúntate si hay una vía más limpia. No sobre-ingenierices lo obvio.
6. **Arreglar bugs solo** — ante un reporte, apunta a los logs y los tests que fallan y resuélvelo sin pedir instrucciones.

**🟠 Regla de oro:** proactivo, mentalidad de dueño, criterio de ingeniero senior. Nunca hagas que te repitan algo.

---

## ✅ Gestión de tareas

1. Escribe el plan en `tasks/todo.md` como ítems marcables antes de programar.
2. Valida el plan con el owner antes de implementar.
3. Marca avances en `tasks/todo.md` sobre la marcha.
4. Resume en alto nivel cada paso.
5. Agrega sección de revisión en `tasks/todo.md` al terminar.
6. Toda corrección se guarda como nota `type: feedback` en memoria de proyecto, no en un archivo desechable.

---

## 🧠 Conocimiento y memoria — léelo PRIMERO, ahorra contexto

- **Memoria de proyecto (el *porqué*)** → `~/.claude/projects/C--Users-LUIS-adv-sales-copilot/memory/`. Se auto-carga cada sesión. Ahí viven decisiones, glosario, contexto vivo y gotchas. Cuando aprendas algo no obvio, añade un archivo plano (`decision-*.md`, `domain-*.md`, `context-*.md`) y una línea en `MEMORY.md`.
- **Grafo de código (el *qué conecta con qué*)** → Graphify. Para cualquier "dónde se usa X / cómo fluye esto", corre `/graphify query "…"` ANTES de grepear. Refresca con `/graphify . --update`. `graphify-out/` está gitignored: se regenera con `/graphify . --obsidian`.

Regla: **pregunta de código → graphify primero. "Por qué / cuál es el plan / qué significa este término" → memoria primero.**

---

## 🔌 Descubrimiento de skills (sin exagerar)

Antes de escribir a mano una capacidad común (testing, deploy, changelog, revisión de PR), revisa si ya existe: `npx skills find <query>` o la skill **find-skills**. Solo cuando falte algo claramente — no interrumpas trabajo de rutina para ir de compras.

---

## 🌿 Git y paralelización

- **`main` es tronco y se mantiene desplegable. Nunca commitees directo a `main`.**
- Una unidad de trabajo → una rama (`feat/`, `fix/`, `chore/`, `refactor/<slug>`) → un PR enfocado. El cuerpo del PR lleva qué/por qué + plan de prueba + criterios de aceptación. **Un humano mergea** con CI en verde.
- Modo de paralelización: **decidir después**. Cuando haya que partir trabajo: o una sola sesión con subagentes, o varias sesiones con `git worktree add ../adv-sales-copilot-wt/<slug> -b feat/<slug>` y propiedad de archivos disjunta.
- `*-wt/` y `.worktrees/` están gitignored.

---

## 🚦 Flujo de entrega — contrato SAW Nivel 1

**Se aplica por unidad de trabajo, a tu criterio.** Pon puerta cuando el cambio mergea a `main`, tiene efecto externo (enviar/publicar/borrar/cobrar/desplegar) o es no trivial. Sáltala en typos y refactors locales reversibles.

- **Stop-the-line:** antes de empezar, confirma que existen criterios de aceptación. Si faltan, **para y consulta a Luis** — nunca inventes requisitos.
- **Verificación independiente:** quien implementa no valida. Un subagente revisor con contexto fresco, o una persona. Auto-aprobarse no es una puerta.
- **Evidencia antes de "listo":** salida de tests, logs, capturas. No "confía en mí".
- **Cadena de estados:** Implementador → revisión independiente → PR/CI → HITL → MERGE. Solo un humano mergea.

### Hardstops heredados de Advantio (estos NO son discrecionales)

| ID | Momento | Qué exige |
|---|---|---|
| **H-SEC** | Antes de cualquier go-live o de tocar producción/DNS/VPS | Checklist de lanzamiento + seguridad, **con la salida en verde de `supabase/tests/no-cruce-entre-tenants.sql` adjunta**. El build es autónomo; el go-live NO. |
| **H-DATA** | Configuración de datos del cliente final | Aislamiento verificado, cifrado en reposo, retención declarada, cero cruce entre dealers. |
| **H-PRICE** | Pricing listo o costo al alza | Luis aprueba desglose y precio antes de que llegue al cliente. Costo interno y margen nunca se muestran al cliente. |
| **H7** | Dato contradictorio o ausente | Se pregunta a Luis. **No se improvisa arquitectura.** |

> **H7 abierto (ver `decision-multitenant-vs-h-data` en memoria):** el `CLAUDE.md` de Advantio declara deploy por cliente y H-DATA exige aislamiento por instancia; este producto es multi-tenant con RLS. Luis autorizó construir así el 2026-09-20; la enmienda a los documentos rectores **no está aplicada** y bloquea H-SEC.

## Qué falta para producción
Antes de proponer trabajo nuevo, lee [`docs/PENDIENTES.md`](docs/PENDIENTES.md): es la fuente única
de lo que bloquea el go-live, qué decisiones esperan a Luis, y qué NO se debe inventar.

## Build y ejecución
- `npm install`
- `cp .env.example .env.local` y llena los valores reales
- `npm run dev` · panel en `/kanban`, webhook en `/api/whatsapp/webhook`
- `npm run db:push` aplica migraciones · `npm run batch:nightly` encola resúmenes por Batch API

## Pruebas
- `npm test` (Vitest) · `npx tsc --noEmit` (tipos en estricto)
- `psql "$DATABASE_URL" -f supabase/tests/no-cruce-entre-tenants.sql` — **prueba de no-cruce entre tenants, evidencia de H-SEC**
- Corre la prueba de humo antes de afirmar que algo funciona.

## Arquitectura
- **Entrada:** `src/app/api/whatsapp/webhook/route.ts` valida firma HMAC sobre el cuerpo crudo, responde 200 y despacha a `src/orchestrator/handle-inbound.ts`.
- **Turno:** `src/agent/run-turn.ts` corre el bucle de herramientas. El modelo elige *qué* herramienta llamar; lo que la herramienta *hace* lo decide `src/orchestrator/ports.ts`.
- **Decisión:** `src/domain/prequalification.ts` es código puro, sin red ni LLM. Es el único lugar que emite el semáforo.
- **Datos:** Supabase con `tenant_id` en toda tabla y RLS **forzada**. El aislamiento lo hace el motor, no la aplicación.
- **Config:** reglas por dealer en `config/tenants/*.json` (esquema en `config/schema/`), nunca en el prompt ni en el código.
- **Contratos:** zod en `src/schemas/` valida todo lo que cruza una frontera de módulo.

## Reglas críticas
- **El modelo NUNCA decide si alguien califica.** Lo calcula el motor determinista contra las reglas del dealer.
- **El sistema NUNCA emite una decisión de crédito.** Es del banco, y va explícito en la UI, en el prompt y en el payload de la herramienta.
- **`tenant_id` en TODA tabla nueva + política RLS.** Sin excepción, sin "esta es interna".
- **Toda herramienta lleva `strict: true` + `additionalProperties: false` + `required` completo.**
- **Prompt caching activo:** cuerpo estable del prompt y definiciones de herramientas cacheadas; el bloque del dealer va DESPUÉS del breakpoint. Orden de `TOOLS` estable — reordenarlo tumba la caché de todas las conversaciones vivas.
- **Prohibida la cascada Haiku→Sonnet.** Las cachés son model-scoped. Si Haiku no alcanza: `claude-sonnet-5` a `effort: low`, medido antes de cambiar.
- **Diseñar para entrante.** Se responde, no se inicia. Toda salida pasa por `src/domain/conversation-window.ts`.
- **Los contadores de consumo son la factura.** Todo evento facturable entra por `usage_events` con clave de idempotencia. Nadie escribe `usage_counters` a mano.
- Nunca commitees secretos. `SUPABASE_SERVICE_ROLE_KEY` salta RLS: solo servidor.
- Datos inmutables por defecto; muchos archivos pequeños (200–400 líneas, 800 tope).

## Gotchas
- Los documentos de identidad **solo se almacenan**, no se leen por visión (decisión de Luis, 2026-09-20). Si eso cambia, es ruta de dato regulado: hay que medir Haiku vs Sonnet 5 en extracción de cédula antes de elegir modelo.
- Las tarifas de WhatsApp de Meta cambian el **2026-10-01**: revalida el costo unitario después de esa fecha.
- Windows: sin symlink `prompts/current`. La versión activa la elige `PROMPT_VERSION`.
