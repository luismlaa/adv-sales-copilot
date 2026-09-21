-- ═══════════════════════════════════════════════════════════════════════════
-- adv-sales-copilot · migracion inicial
--
-- Invariantes que esta migracion hace cumplir a nivel de motor:
--   H-DATA-1  tenant_id NOT NULL en TODA tabla de negocio, sin excepcion.
--   H-DATA-2  RLS habilitada y FORZADA en toda tabla de negocio.
--   H-DATA-3  Los contadores de consumo nacen con el esquema — son la factura,
--             no telemetria. Retrofitearlos deja meses sin poder cobrar.
--   H-SEC-1   Los documentos de identidad no se guardan en Postgres: solo su
--             puntero a Storage, con retencion declarada y borrado al cierre.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · Tenancy
-- ───────────────────────────────────────────────────────────────────────────

create table tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]{3,48}$'),
  nombre          text not null,
  -- ID del numero en la Cloud API (no el numero en si): es lo que trae el
  -- webhook de Meta en metadata.phone_number_id y por lo que resolvemos el dealer.
  wa_phone_number_id text not null unique,
  zona_horaria    text not null default 'America/Santo_Domingo',
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

comment on table tenants is 'Un dealer. Raiz del aislamiento: todo lo demas cuelga de aqui.';

create table tenant_members (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rol         text not null check (rol in ('owner', 'vendedor', 'lectura')),
  creado_en   timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- Pertenencia del usuario autenticado. SECURITY DEFINER para que las politicas
-- RLS puedan leer tenant_members sin recursion infinita de politicas.
create or replace function auth_has_tenant(t uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from tenant_members where user_id = auth.uid() and tenant_id = t
  )
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · Reglas de pre-calificacion — CONFIGURACION, no prompt
--     El modelo nunca decide si un prospecto califica. Una tool determinista
--     evalua estas reglas. La decision crediticia final es del banco.
-- ───────────────────────────────────────────────────────────────────────────

create table prequalification_rulesets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  version       integer not null,
  reglas        jsonb not null,      -- valida contra config/schema/tenant-rules.schema.json
  vigente       boolean not null default false,
  creado_en     timestamptz not null default now(),
  unique (tenant_id, version)
);

-- Exactamente un ruleset vigente por tenant.
create unique index prequalification_rulesets_vigente_uniq
  on prequalification_rulesets (tenant_id) where vigente;

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · Inventario (importacion CSV/Excel desde el dia uno)
-- ───────────────────────────────────────────────────────────────────────────

create table import_batches (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  tipo          text not null check (tipo in ('vehiculos', 'leads')),
  archivo       text not null,
  filas_ok      integer not null default 0,
  filas_error   integer not null default 0,
  errores       jsonb not null default '[]'::jsonb,
  creado_por    uuid references auth.users(id),
  creado_en     timestamptz not null default now()
);

create table vehicles (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  -- Clave natural del dealer: hace la importacion idempotente (re-subir el
  -- mismo archivo actualiza, nunca duplica).
  stock_id      text not null,
  marca         text not null,
  modelo        text not null,
  anio          integer not null check (anio between 1950 and 2100),
  version       text,
  precio        numeric(12,2) not null check (precio >= 0),
  moneda        text not null default 'DOP' check (moneda in ('DOP', 'USD')),
  kilometraje   integer check (kilometraje >= 0),
  transmision   text check (transmision in ('automatica', 'manual')),
  combustible   text check (combustible in ('gasolina', 'gasoil', 'hibrido', 'electrico', 'glp')),
  disponible    boolean not null default true,
  import_id     uuid references import_batches(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  creado_en     timestamptz not null default now(),
  unique (tenant_id, stock_id)
);

create index vehicles_busqueda on vehicles (tenant_id, disponible, marca, modelo, precio);

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · Leads, conversaciones y mensajes
-- ───────────────────────────────────────────────────────────────────────────

create type lead_etapa as enum (
  'nuevo', 'calificado', 'expediente_completo', 'test_drive', 'negociacion', 'perdido'
);

create type lead_temperatura as enum ('frio', 'tibio', 'caliente');

create table leads (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  telefono          text not null,
  nombre            text,
  etapa             lead_etapa not null default 'nuevo',
  temperatura       lead_temperatura not null default 'frio',
  -- Ficha de calificacion: uso, presupuesto, intercambio, financiamiento.
  ficha             jsonb not null default '{}'::jsonb,
  vehiculo_interes  uuid references vehicles(id) on delete set null,
  asignado_a        uuid references auth.users(id) on delete set null,
  import_id         uuid references import_batches(id) on delete set null,
  actualizado_en    timestamptz not null default now(),
  creado_en         timestamptz not null default now(),
  -- Un telefono es un lead por dealer. El mismo numero puede hablar con dos
  -- dealers distintos sin que sus datos se crucen.
  unique (tenant_id, telefono)
);

create index leads_tablero on leads (tenant_id, etapa, temperatura, actualizado_en desc);

create table conversations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  lead_id           uuid not null references leads(id) on delete cascade,
  estado            text not null default 'abierta'
                      check (estado in ('abierta', 'calificada', 'escalada', 'cerrada')),
  turnos            integer not null default 0,
  -- Ventana de 24h de Meta: dentro de ella responder no cuesta; fuera, toda
  -- salida exige plantilla y se factura. El flujo esta disenado para entrante.
  ventana_expira_en timestamptz,
  -- Se marca una sola vez, cuando la calificacion se completa. Es lo que
  -- alimenta el contador facturable conversaciones_atendidas.
  contabilizada_en  timestamptz,
  creado_en         timestamptz not null default now()
);

create index conversations_lead on conversations (tenant_id, lead_id, creado_en desc);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  direccion       text not null check (direccion in ('entrante', 'saliente')),
  rol             text not null check (rol in ('user', 'assistant')),
  cuerpo          text not null,
  -- id de mensaje de Meta: hace el webhook idempotente. Meta reintenta.
  wa_message_id   text,
  categoria       text check (categoria in ('servicio', 'utility', 'marketing')),
  creado_en       timestamptz not null default now(),
  unique (tenant_id, wa_message_id)
);

create index messages_conversacion on messages (tenant_id, conversation_id, creado_en);

-- ───────────────────────────────────────────────────────────────────────────
-- 5 · Expediente — documentos de identidad de terceros
--     El binario vive en Supabase Storage (cifrado en reposo). Aqui solo el
--     puntero, la retencion y la trazabilidad del borrado.
-- ───────────────────────────────────────────────────────────────────────────

create type documento_tipo as enum (
  'cedula_frontal', 'cedula_dorsal', 'carta_trabajo', 'estado_cuenta', 'licencia', 'otro'
);

create type documento_estado as enum ('pendiente', 'recibido', 'rechazado', 'borrado');

create table lead_documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  lead_id         uuid not null references leads(id) on delete cascade,
  tipo            documento_tipo not null,
  estado          documento_estado not null default 'pendiente',
  storage_path    text,                  -- <bucket>/<tenant_id>/<lead_id>/<uuid>
  mime            text,
  bytes           integer check (bytes >= 0),
  -- Retencion declarada: se borra al cierre del expediente o en esta fecha,
  -- lo que ocurra primero. Sin fecha no hay go-live (H-SEC).
  retener_hasta   date not null,
  borrado_en      timestamptz,
  subido_en       timestamptz,
  creado_en       timestamptz not null default now()
);

-- Un documento clasificado por tipo es unico por lead. `otro` queda fuera del
-- indice a proposito: mientras no leamos los documentos por vision no podemos
-- clasificarlos, y varios adjuntos sin clasificar deben poder convivir hasta
-- que el vendedor los asigne.
create unique index lead_documents_tipo_uniq
  on lead_documents (tenant_id, lead_id, tipo) where tipo <> 'otro';

create index lead_documents_retencion on lead_documents (retener_hasta)
  where borrado_en is null and estado = 'recibido';

-- ───────────────────────────────────────────────────────────────────────────
-- 6 · Resultado de pre-calificacion (semaforo)
--     Producido por la tool determinista, nunca por el modelo.
-- ───────────────────────────────────────────────────────────────────────────

create type semaforo as enum ('califica', 'revisar', 'no_califica');

create table qualification_results (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  lead_id         uuid not null references leads(id) on delete cascade,
  ruleset_id      uuid not null references prequalification_rulesets(id),
  resultado       semaforo not null,
  -- Cada regla evaluada con su veredicto: por que dio lo que dio.
  detalle         jsonb not null,
  faltantes       text[] not null default '{}',
  creado_en       timestamptz not null default now()
);

create index qualification_results_lead on qualification_results (tenant_id, lead_id, creado_en desc);

-- ───────────────────────────────────────────────────────────────────────────
-- 7 · Consumo — ESTO ES LA FACTURA
--     Regla: primero lo incluido en la base, luego los paquetes comprados en
--     orden de compra. Mes sin actividad = solo la base.
-- ───────────────────────────────────────────────────────────────────────────

create type contador as enum ('conversaciones_atendidas', 'recordatorios', 'reactivaciones');

-- Ledger inmutable. Una fila por evento facturable; nunca se actualiza.
create table usage_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  contador        contador not null,
  periodo         date not null,        -- primer dia del mes, en la zona del tenant
  cantidad        integer not null default 1 check (cantidad > 0),
  -- Clave de idempotencia: conversation_id para conversaciones, wa_message_id
  -- para plantillas salientes. Un reintento de Meta no factura dos veces.
  idempotency_key text not null,
  referencia      jsonb not null default '{}'::jsonb,
  creado_en       timestamptz not null default now(),
  unique (tenant_id, contador, idempotency_key)
);

create index usage_events_periodo on usage_events (tenant_id, periodo, contador);

-- Agregado por tenant y mes. Lo que se lee para facturar.
create table usage_counters (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  periodo     date not null,
  contador    contador not null,
  total       integer not null default 0 check (total >= 0),
  actualizado_en timestamptz not null default now(),
  primary key (tenant_id, periodo, contador)
);

-- Paquetes comprados. Se consumen en orden de compra (FIFO por comprado_en).
create table usage_packages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  contador      contador not null,
  unidades      integer not null check (unidades > 0),
  consumidas    integer not null default 0 check (consumidas >= 0),
  comprado_en   timestamptz not null default now(),
  vence_en      date,
  check (consumidas <= unidades)
);

create index usage_packages_fifo on usage_packages (tenant_id, contador, comprado_en);

-- Cupo incluido en la base mensual del plan del tenant.
create table tenant_plan (
  tenant_id                        uuid primary key references tenants(id) on delete cascade,
  base_conversaciones_atendidas    integer not null default 0 check (base_conversaciones_atendidas >= 0),
  base_recordatorios               integer not null default 0 check (base_recordatorios >= 0),
  base_reactivaciones              integer not null default 0 check (base_reactivaciones >= 0),
  actualizado_en                   timestamptz not null default now()
);

-- El ledger alimenta el agregado. Una sola via de escritura: insertar en
-- usage_events. Nadie toca usage_counters a mano.
create or replace function usage_events_rollup()
returns trigger
language plpgsql
as $fn$
begin
  insert into usage_counters (tenant_id, periodo, contador, total, actualizado_en)
  values (new.tenant_id, new.periodo, new.contador, new.cantidad, now())
  on conflict (tenant_id, periodo, contador) do update
    set total = usage_counters.total + excluded.total,
        actualizado_en = now();
  return new;
end;
$fn$;

create trigger usage_events_rollup_trg
  after insert on usage_events
  for each row execute function usage_events_rollup();

-- ───────────────────────────────────────────────────────────────────────────
-- 8 · Bitacora de acciones — contexto de negocio, no solo errores HTTP
-- ───────────────────────────────────────────────────────────────────────────

create table action_log (
  id            bigserial primary key,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  actor         text not null,          -- 'copiloto' | 'sistema' | user_id
  accion        text not null,
  entidad       text not null,
  entidad_id    uuid,
  motivo        text not null,          -- POR QUE, no solo que
  metadata      jsonb not null default '{}'::jsonb,
  creado_en     timestamptz not null default now()
);

create index action_log_entidad on action_log (tenant_id, entidad, entidad_id, creado_en desc);

-- ───────────────────────────────────────────────────────────────────────────
-- 9 · RLS — aislamiento a nivel de motor, no de aplicacion
--     FORCE hace que ni el dueno de la tabla la evada. La service_role key
--     sigue saltando RLS por diseno: por eso solo vive en el servidor.
-- ───────────────────────────────────────────────────────────────────────────

do $rls$
declare
  t text;
  tablas text[] := array[
    'tenant_members', 'prequalification_rulesets', 'import_batches', 'vehicles',
    'leads', 'conversations', 'messages', 'lead_documents', 'qualification_results',
    'usage_events', 'usage_counters', 'usage_packages', 'tenant_plan', 'action_log'
  ];
begin
  foreach t in array tablas loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all to authenticated using (auth_has_tenant(tenant_id)) with check (auth_has_tenant(tenant_id))',
      t || '_tenant_isolation', t
    );
  end loop;
end
$rls$;

-- tenants se filtra por id, no por tenant_id.
alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenants_tenant_isolation on tenants
  for all to authenticated
  using (auth_has_tenant(id))
  with check (auth_has_tenant(id));

-- Los contadores de consumo son de solo lectura para el dealer: los escribe
-- el servidor. Que el dealer pudiera editarlos seria editar su propia factura.
revoke insert, update, delete on usage_counters from authenticated;
revoke insert, update, delete on usage_events from authenticated;
revoke update, delete on usage_packages from authenticated;
