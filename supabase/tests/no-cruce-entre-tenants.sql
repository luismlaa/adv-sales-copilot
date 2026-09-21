-- ═══════════════════════════════════════════════════════════════════════════
-- Prueba de no-cruce entre tenants — EVIDENCIA OBLIGATORIA DE H-SEC
--
-- El producto guarda cedulas y cartas de trabajo de los clientes del dealer:
-- datos de identidad de terceros, en base compartida. Esta prueba es la que
-- demuestra que un dealer no puede ver ni tocar los datos de otro.
--
-- Corre contra una base limpia:
--     supabase db reset
--     psql "$DATABASE_URL" -f supabase/tests/no-cruce-entre-tenants.sql
--
-- Cualquier RAISE EXCEPTION aqui BLOQUEA el go-live. No se aprueba H-SEC sin
-- esta salida en verde, adjunta al checklist de lanzamiento.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── Montaje: dos dealers, un usuario en cada uno ──────────────────────────
insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'vendedor@dealer-a.test'),
  ('22222222-2222-4222-8222-222222222222', 'vendedor@dealer-b.test')
on conflict (id) do nothing;

insert into tenants (id, slug, nombre, wa_phone_number_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dealer-a', 'Dealer A', '10000000001'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dealer-b', 'Dealer B', '10000000002');

insert into tenant_members (tenant_id, user_id, rol) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner');

insert into leads (id, tenant_id, telefono, nombre) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '18090000001', 'Lead de A'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '18090000002', 'Lead de B');

insert into lead_documents (tenant_id, lead_id, tipo, estado, retener_hasta) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cedula_frontal', 'recibido', current_date + 90),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cedula_frontal', 'recibido', current_date + 90);

-- ── Nos hacemos pasar por el vendedor del Dealer A ────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $t$
declare
  visibles integer;
  docs integer;
  filas integer;
begin
  -- 1 · Solo ve sus propios leads
  select count(*) into visibles from leads;
  if visibles <> 1 then
    raise exception 'FALLO no-cruce: el Dealer A ve % leads, deberia ver 1', visibles;
  end if;

  -- 2 · El lead del otro dealer no existe para el
  select count(*) into visibles from leads where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  if visibles <> 0 then
    raise exception 'FALLO no-cruce: el Dealer A alcanza el lead del Dealer B';
  end if;

  -- 3 · Los documentos de identidad tampoco cruzan
  select count(*) into docs from lead_documents;
  if docs <> 1 then
    raise exception 'FALLO no-cruce: el Dealer A ve % documentos, deberia ver 1', docs;
  end if;

  -- 4 · No puede MODIFICAR un lead ajeno (RLS filtra el UPDATE a cero filas)
  update leads set nombre = 'secuestrado'
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  get diagnostics filas = row_count;
  if filas <> 0 then
    raise exception 'FALLO no-cruce: el Dealer A modifico % filas del Dealer B', filas;
  end if;

  -- 5 · No puede INSERTAR bajo el tenant ajeno (WITH CHECK lo rechaza)
  begin
    insert into leads (tenant_id, telefono, nombre)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '18090000003', 'inyectado');
    raise exception 'FALLO no-cruce: el Dealer A inserto un lead bajo el Dealer B';
  exception
    when insufficient_privilege or check_violation then null;  -- esperado
  end;

  -- 6 · No puede escribir sus propios contadores de consumo (es su factura)
  begin
    insert into usage_events (tenant_id, contador, periodo, idempotency_key)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'conversaciones_atendidas', date_trunc('month', current_date), 'falso-1');
    raise exception 'FALLO: el dealer pudo escribir su propio consumo facturable';
  exception
    when insufficient_privilege then null;  -- esperado
  end;

  raise notice 'OK · no-cruce entre tenants verificado (6 de 6)';
end
$t$;

reset role;
rollback;
