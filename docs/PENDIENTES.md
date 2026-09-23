# Pendientes para cerrar la pre-build y salir a clientes

> **Qué es este archivo.** El inventario completo de lo que falta entre el estado de hoy
> y un dealer real usando el producto en producción. Es la fuente única: `tasks/todo.md`
> lleva el plan del día a día y apunta aquí.
>
> Última revisión: **2026-09-23** · rama `feat/dealer-demo-y-login` · 58 pruebas en verde · `tsc --noEmit` limpio · `next build` compila · migración y demo verificadas contra Supabase local · proyecto real creado y migrado (P0-2)

---

## Estado de hoy — lo que ya funciona y está probado

| Pieza | Estado |
|---|---|
| Esquema con `tenant_id` en toda tabla + RLS forzada | Aplica limpio en Supabase local; RLS verificada (sin sesión 0 filas, con sesión las del dealer). Migración aplicada en el proyecto real (P0-2, 2026-09-23) |
| Motor determinista de pre-calificación | Funciona, 12 pruebas |
| Herramientas `strict: true` + structured outputs | Funciona, 6 pruebas de contrato |
| Prompt caching con corte estable/volátil | Funciona, instrumentado con `tasaCache()` |
| Ventana de 24h como autoridad de salida | Funciona, 7 pruebas |
| Webhook con firma HMAC + idempotencia | Funciona, sin probar contra Meta real |
| Importación CSV/Excel con sinónimos | Funciona, 5 pruebas |
| Contador `conversaciones_atendidas` | Funciona |
| Contadores `recordatorios` y `reactivaciones` | **No se escriben nunca** — ver P1-1 |
| Kanban del dealer | Con login y dealer de ejemplo: muestra los 8 prospectos demo |
| Login del dealer | Supabase Auth + middleware de sesión + `/login` |
| Dealer de ejemplo | `npm run db:seed-demo` — idempotente |

---

## Bloque 0 · Decisiones de Luis — bloquean, no se improvisan

Ninguna de estas la puede tomar un agente. Todas son H7 o materia de hardstop.

- [~] **D-1 · Enmienda H7: multi-tenant vs H-DATA.** Decidido 2026-09-21: pre-build y a medida no se rigen
      por las mismas normas. Texto listo en [`decisiones/D-1-enmienda-h7.md`](decisiones/D-1-enmienda-h7.md);
      falta aplicarlo en `advantio/` (la copia local está desincronizada del remoto).
      `advantio/CLAUDE.md` declara deploy por cliente y `operacion/HARDSTOPS.md` (H-DATA) exige
      aislamiento por instancia. Este producto es multi-tenant con RLS. Autorizaste construirlo
      así el 2026-09-20, pero **la enmienda no está redactada ni aplicada**.
      → *Bloquea H-SEC.* Mientras no exista, aprobar el go-live contradice tus propios documentos rectores.

- [~] **D-2 · Quién es dueño de la WABA.** Luis se inclina por **B (WABA por dealer)**, 2026-09-21.
      Matices: B aísla la calificación de calidad entre dealers, pero no aísla más los datos, y
      **no hace más rápido el alta** (cada dealer verifica su negocio y aprueba plantillas; Advantio
      debe hacerse Tech Provider). Opciones de cobro con B: (1) Meta cobra al dealer y Advantio cobra
      base + conversaciones + tarifa de servicio por plantilla — *recomendada*; (2) Solution Partner o
      BSP con línea de crédito, Advantio revende con margen; (3) A primero, B con volumen.
      **Falta que Luis elija la opción de cobro.** Texto original de la decisión: Decide el modelo de facturación completo:
      - **A · WABA de Advantio** — verificación una vez, plantillas una vez, **Meta te cobra a ti**,
        tus contadores *son* la factura. Riesgo: rating de calidad compartido, un dealer que abuse
        puede tumbar a todos.
      - **B · WABA por dealer** (Advantio como Tech Provider) — cada dealer verifica su negocio y
        aprueba sus plantillas, **Meta le cobra directo al dealer**, tus contadores pasan a ser
        lo que *reportas*, no lo que cobras. Contradice §4 del brief tal como está escrita.

      Recomendación: **A** para los primeros dealers, migrar a B cuando el volumen justifique el
      riesgo de blast radius. → *Bloquea D-3, P0-4 y el pricing.*

- [ ] **D-3 · Dónde viven los access tokens de WhatsApp.** Depende de D-2.
      Con el modelo A basta el token global de `.env`. Con el modelo B, cada dealer trae el suyo
      y hay que decidir el almacén: Supabase Vault, un secret manager externo, o cifrado en
      columna. **Guardar tokens de terceros en la base es materia de H-DATA** — deliberadamente
      no lo inventé.

- [x] **D-4 · Lectura de documentos por visión.** Cerrado 2026-09-21: **solo se almacenan.**
      Si se activa, es ruta de dato regulado: el brief exige **medir Haiku vs Sonnet 5 en extracción
      de cédula antes de elegir modelo**, y H-SEC se reabre.
      → Punto de cambio aislado: `textoDelMensaje()` en `src/orchestrator/handle-inbound.ts`.

- [x] **D-5 · Alcance de la Ley 172-13.** Cerrado 2026-09-21 por Luis: no bloquea; solo se recopilan documentos.
      Pendiente menor: consentimiento explícito del prospecto en el chat antes de pedir la cédula.
      → *Bloquea el contrato*, no el build.

---

## Bloque 1 · P0 — sin esto no funciona de punta a punta

- [x] **P0-1 · Auth del dealer.** Hecho 2026-09-21 con usuario de ejemplo (correo + clave). Sin alta de vendedores ni recuperación de clave todavía. Supabase Auth + middleware de refresco de sesión + pantalla de login.
      **Es lo primero.** Sin sesión, RLS devuelve vacío y el Kanban se ve en blanco: hoy el panel
      es indemostrable ante un cliente. *(M)*

- [x] **P0-2 · Proyecto de Supabase creado y migración aplicada.** Cerrado 2026-09-23 por Luis.
      Proyecto `zrvstevcddpiihfpxoup` con `0001_init.sql` aplicada (vía *Session pooler*, sin
      `supabase login`). Pendiente de verificación independiente: correr S-2 contra esta base.
      Siguiente: `npm run db:seed-demo` contra el proyecto real (P0-3). *(S)*

- [x] **P0-3 · Seed de un tenant completo** — `scripts/seed-demo.ts`. Correr contra el proyecto real al cerrar P0-2.: dealer + ruleset **vigente** + plan con cupos base +
      usuario en `tenant_members`.
      Sin ruleset vigente el webhook lanza excepción en el primer mensaje. *(S)*

- [ ] **P0-4 · Meta operativo.** Ver el desglose de "una vez vs por dealer" abajo. **Es el camino
      crítico**: la verificación de negocio y la aprobación de plantillas toman días o semanas, no horas.
      Arranca por aquí aunque el código no esté listo. *(L, calendario)*

- [ ] **P0-5 · Webhook probado contra Meta de verdad.** Handshake `GET`, firma HMAC sobre cuerpo
      crudo, y una conversación entera ida y vuelta. La firma está implementada y nunca verificada
      contra un payload real de Meta. *(S)*

- [ ] **P0-6 · Bucket de Storage creado** (`expedientes`) con cifrado en reposo. *(S)*

---

## Bloque 2 · P0 de seguridad — sin esto no hay H-SEC

> **Etapa 2** (decisión 2026-09-21). Con la enmienda D-1 estos puntos son parte de H-DATA-PB:
> la etapa 2 va antes del primer dealer con datos reales, no después.

- [ ] **S-1 · Políticas RLS sobre `storage.objects`.**
      Hoy el aislamiento de los binarios depende de la convención de ruta
      (`<tenant_id>/<lead_id>/<media_id>`), **no del motor**. Un bug de ruta cruza documentos de
      identidad entre dealers. Esto es exactamente lo que RLS evita en las tablas y falta en Storage. *(M)*

- [ ] **S-2 · Correr la prueba de no-cruce contra una base real.**
      `supabase/tests/no-cruce-entre-tenants.sql` está escrita y **nunca ejecutada**.
      Su salida en verde es **evidencia obligatoria** del checklist de lanzamiento. *(S)*

- [ ] **S-3 · Job de retención.** Borrar de Storage y marcar `borrado_en` los documentos cuyo
      `retener_hasta` venció o cuyo expediente cerró.
      Hoy la fecha se guarda y **nadie la hace cumplir**: retención declarada sin borrado real
      es incumplimiento, no mitigación. *(M)*

- [ ] **S-4 · Revisión de `security-eng` + H-SEC firmado por Luis.** Con S-2 adjunto. *(—)*

- [ ] **S-5 · H-DATA firmado.** Aislamiento, cifrado, retención y responsabilidades. Depende de D-1. *(—)*

---

## Bloque 3 · P1 — sin esto no cobras bien ni operas

- [ ] **P1-1 · Recordatorios y reactivaciones.** Bloqueado por la opción de cobro de D-2. Preguntas
      abiertas a Luis (2026-09-21): qué es recordatorio (propuesta: documentos pendientes, *utility*) y
      qué es reactivación; cadencia y tope por lead; envío automático o aprobado por el vendedor;
      qué pasa al agotar base + paquetes; solo en horario del dealer. ⚠️ **Hueco de facturación conocido.**
      `enviarPlantilla()` existe y **nadie la llama**; `usage_events` solo se escribe para
      `conversaciones_atendidas`. **De los tres conceptos que cobras, hoy solo se cuenta uno.**
      Falta: el disparador (lead tibio sin respuesta en N horas), las plantillas aprobadas, y el
      `usage_event` con el `messageId` de Meta como clave de idempotencia. *(M)*

- [ ] **P1-2 · Pantalla de importación de inventario.** El endpoint `POST /api/import/inventario`
      funciona; el dealer no tiene dónde soltar el archivo. Incluye mostrar los errores por fila,
      que ya vienen con número de línea. *(M)*

- [ ] **P1-3 · Calibrar el costo unitario.** Medir una conversación de calificación real contra la
      API: turnos, tokens de entrada y salida, tasa de caché. Es barato y convierte el precio de
      supuesto en dato. Precedente: se hizo con `atencion-ia` el 2026-07-31. *(S)*

- [ ] **P1-4 · Revalidar tarifas de WhatsApp después del 2026-10-01.** Confirmado: desde esa fecha los
      mensajes de servicio (respuestas dentro de la ventana de 24h) **se cobran** pasados 1.000 gratis por
      número al mes, igual que las plantillas *utility* enviadas dentro de la ventana. Rompe el supuesto
      "responder es gratis" de `conversation-window.ts`. Con WABA por dealer ese costo lo paga el dealer.
      → *Bloquea H-PRICE* si el costo sube. *(S)*

- [ ] **P1-5 · Vista de expediente por lead.** Abrir la tarjeta, ver los documentos, y **reasignar
      un adjunto mal atribuido**. Como no leemos por visión, la atribución es heurística: el adjunto
      llena la casilla pedida más antigua. El vendedor necesita poder corregirla antes de mandar el
      expediente al banco. *(M)*

- [ ] **P1-6 · Mover etapas en el Kanban.** Hoy el tablero es de solo lectura: el vendedor no puede
      mover una tarjeta a Test drive o Negociación. *(M)*

- [ ] **P1-7 · Alertas básicas.** Tasa de error del webhook, caché en cero (invalidador silencioso),
      y fallos de envío de WhatsApp. *(S)*

---

## Bloque 4 · P2 — robustez, primer mes

- [ ] **P2-1 · Modo dry-run**: registrar lo que el copiloto respondería sin enviarlo. Es lo que te
      deja afinar el prompt con un dealer real sin quemarle leads.
- [ ] **P2-2 · Rate limiting y tope de gasto** por tenant y por conversación.
- [ ] **P2-3 · Circuit breaker** para la Graph API de Meta.
- [ ] **P2-4 · Eval del prompt**: un set de conversaciones reales anonimizadas con el resultado
      esperado, para que cambiar el prompt deje de ser a ciegas.
- [ ] **P2-5 · Panel de consumo para el dealer**: cuánto lleva del cupo base este mes.
- [ ] **P2-6 · CI**: correr `npm test` + `tsc` + la prueba de no-cruce en cada PR.
- [ ] **P2-7 · `tree_sitter_sql`** (`pip install "graphifyy[sql]"`) para que las migraciones entren
      al grafo de código.

---

## Meta: qué es una vez y qué es por cliente

**Una sola vez, para Advantio:**
- Meta Business Account + verificación del negocio de Advantio
- **Una** app de Meta: un webhook, un `APP_SECRET`, un endpoint para todos los dealers

**Por cada dealer, en los dos modelos, sin excepción:**
- Un número propio registrado en la Cloud API — un número vive en una sola cuenta a la vez, no se comparte ni se recicla
- Revisión del *display name* de ese número por Meta

**Lo que depende de D-2:** verificación de negocio, aprobación de plantillas y a quién le cobra Meta.

> Verifica contra la documentación vigente de Meta antes de comprometerte: los nombres de programa
> y los requisitos cambian, y el brief ya avisa del cambio de tarifas del 2026-10-01.

---

## Runbook de onboarding por dealer (lo repetible)

Una vez cerrados el Bloque 0 al 2, dar de alta un dealer debería ser esto y nada más:

1. Conectar su número a la Cloud API → anotar su `phone_number_id`
2. `insert into tenants` con ese `wa_phone_number_id` y su zona horaria
3. Cargar su ruleset de pre-calificación y marcarlo `vigente`
4. `insert into tenant_plan` con los cupos base contratados
5. Invitar a sus vendedores a `tenant_members`
6. Importar su inventario por CSV/Excel
7. Suscribir el webhook a ese número
8. Conversación de prueba de punta a punta antes de darle el número al público

**Meta de diseño: que esto sea un formulario, no un agente.** Mientras siga siendo SQL a mano, no
es un producto de catálogo — es una consultoría con más pasos.

---

## Deuda técnica conocida

- ~~`pedirDocumentos` usaba upsert contra un índice único parcial~~ — corregido 2026-09-21. Postgres
  rechaza ese `ON CONFLICT`; la herramienta fallaba siempre y el checklist nunca se creaba.
- **Comprador de contado evaluado como si financiara.** El motor exige ingreso y antigüedad aunque
  `forma_pago = contado` y devuelve `revisar`. Pendiente de decisión de producto.

- **Datos del dealer hardcodeados en el turno.** `handle-inbound.ts` pasa horario y dirección
  literales (`"lunes a sabado, 8:00 am a 6:00 pm"`, `"consultar con el vendedor"`). Deben salir de
  `tenants`. Se ven en cada conversación con el cliente final.
- **Historial plano de 20 mensajes.** Sin compactación ni resumen. Una conversación larga crece el
  costo de entrada de forma lineal; el tope de turnos lo contiene, pero es un parche.
- **`vehiculo_interes` nunca se asigna.** La columna existe, el copiloto busca inventario, pero
  nada enlaza el lead con el vehículo que le interesó.
- **`import_batches.tipo` admite `'leads'`** y solo está implementada la importación de vehículos.
- **Sin symlink `prompts/current`** (Windows). La versión activa la elige `PROMPT_VERSION`.

## Cosas que deliberadamente no inventé

Ninguna de estas es un olvido; cada una espera una decisión del Bloque 0:

- Almacén de tokens de WhatsApp por dealer → **D-3**
- Clasificación de documentos por visión → **D-4**
- Enmienda a los documentos rectores de Advantio → **D-1**, y además nada de este repo debe escribir en `advantio/`

---

## Orden sugerido

**El camino crítico es Meta, no el código.** Arranca P0-4 hoy aunque nada más esté listo: la
verificación y las plantillas corren en calendario, no en horas de trabajo.

```
  hoy ──► P0-4 (Meta, en paralelo con todo lo demás)
           │
  código ──► P0-1 auth ──► P0-2/P0-3 base + seed ──► P0-5 webhook real
                                │
                                └──► S-1 Storage RLS ──► S-2 no-cruce ──► S-3 retención
                                                                              │
                                        D-1 enmienda H7 ──────────────────────┤
                                                                              ▼
                                                                        S-4/S-5 H-SEC + H-DATA
                                                                              │
                                        P1-3 costo ──► H-PRICE ───────────────┤
                                                                              ▼
                                                                          GO-LIVE
```

Después del go-live del primer dealer, en este orden: **P1-1** (cierra el hueco de facturación),
**P1-5 y P1-6** (lo que el vendedor pedirá en la primera semana), **P1-2** (lo que hace que el
segundo dealer no te cueste un día de trabajo).
