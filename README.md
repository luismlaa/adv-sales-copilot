# Sales Copilot

Copiloto de ventas para dealers de vehículos en República Dominicana. Atiende cada lead que entra por WhatsApp, separa al comprador real del curioso, lo califica (uso, presupuesto, intercambio, financiamiento), pre-filtra el financiamiento **contra las reglas de ese dealer** y recoge la documentación — de modo que el vendedor solo abre leads calientes con el expediente ya armado. Multi-tenant: un despliegue sirve a muchos dealers, con aislamiento por `tenant_id` y RLS de Postgres.

**La decisión crediticia es del banco.** El sistema pre-filtra y arma el expediente; nunca emite una decisión de crédito. Eso está explícito en la UI, en el prompt del agente y en la respuesta de la herramienta de evaluación.

## Cómo funciona

```
WhatsApp Cloud API ──► /api/whatsapp/webhook ──► orchestrator/handle-inbound
                          (firma HMAC)                    │
                                                          ▼
                                            agent/run-turn  (claude-haiku-4-5)
                                                          │  tool calls
                                              ┌───────────┴────────────┐
                                              ▼                        ▼
                                  orchestrator/ports          domain/prequalification
                                  (Supabase: ficha,            (código puro: semáforo
                                   inventario, docs)            califica/revisar/no)
```

Dos interfaces:

- **Comprador** — chat de WhatsApp que responde al instante, pregunta lo justo y recibe fotos de documentos por el mismo chat.
- **Dealer** — Kanban en `/kanban`: Nuevo → Calificado → Expediente completo → Test drive → Negociación, con temperatura, checklist de documentos y semáforo por tarjeta.

## Arrancar

```bash
npm install
cp .env.example .env.local     # llena ANTHROPIC_API_KEY, Supabase y WhatsApp
npm run db:push                # aplica supabase/migrations/
npm run dev                    # http://localhost:3000/kanban
```

Para recibir mensajes en local, expón el puerto (por ejemplo con un túnel) y registra `https://<tu-host>/api/whatsapp/webhook` en la app de Meta, con el mismo `WHATSAPP_VERIFY_TOKEN` del `.env.local`.

## Verificar

```bash
npm test                 # 49 pruebas: motor de calificación, consumo, ventana 24h, importación
npx tsc --noEmit         # tipos en estricto
psql "$DATABASE_URL" -f supabase/tests/no-cruce-entre-tenants.sql   # aislamiento entre dealers
```

La última es **evidencia obligatoria de H-SEC**: sin su salida en verde no hay go-live.

## Configurar un dealer

Las reglas de pre-calificación son configuración, no prompt. Cada dealer tiene las suyas — ingreso mínimo, inicial mínima, antigüedad laboral, marcas financiables, documentos exigidos — en `config/tenants/<slug>.json`, validadas contra `config/schema/tenant-rules.schema.json` y cargadas en la tabla `prequalification_rulesets`. `config/tenants/demo-dealer.json` sirve de plantilla.

El inventario entra por CSV o Excel desde el primer día (`POST /api/import/inventario`). El importador reconoce encabezados en español con y sin tildes y varios sinónimos por columna, reporta errores fila por fila sin abortar, y usa `stock_id` como clave natural: volver a subir el mismo archivo actualiza, nunca duplica.

## Medición de consumo

El producto se cobra por uso. La aplicación cuenta y persiste, por tenant y por mes: `conversaciones_atendidas`, `recordatorios` (plantilla *utility* saliente) y `reactivaciones` (plantilla *marketing* saliente). Esto no es telemetría: es la factura, y vive en el esquema desde la primera migración. Todo evento facturable entra por `usage_events` con clave de idempotencia — un reintento de Meta no cobra dos veces.

Regla de consumo: primero lo incluido en la base del plan, luego los paquetes comprados en orden de compra. Mes sin actividad = solo la base.

## Documentación

- `CLAUDE.md` — reglas de trabajo sobre este repo, hardstops y arquitectura en corto
- `docs/architecture.md` — decisiones de arquitectura y sus porqués
- `prompts/CHANGELOG.md` — historial de versiones del prompt
- `tasks/todo.md` — plan vivo y revisión

Brief de origen: `advantio/framework/mercado/ADV-advantio-BRIEF-202609.md`.
