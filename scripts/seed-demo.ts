import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseTenantRules, type DocumentoRequerido, type TenantRules } from "@/schemas/tenant-rules";
import type { Etapa, FichaProspecto } from "@/schemas/lead";
import { evaluarPrecalificacion, temperaturaDe } from "@/domain/prequalification";

/**
 * Dealer de ejemplo, completo y listo para demo.
 *
 * Deja en la base lo minimo para que el producto funcione de punta a punta:
 *  - el dealer (`tenants`) con su numero de WhatsApp
 *  - su ruleset **vigente** — sin el, el webhook falla en el primer mensaje
 *  - su plan con cupos base
 *  - un usuario owner en `tenant_members` — sin el, RLS deja el Kanban vacio
 *  - inventario y prospectos de muestra en todas las etapas del tablero
 *
 * El semaforo de cada prospecto lo calcula el motor determinista real contra
 * las reglas del dealer: la demo muestra lo que el producto haria, no numeros
 * inventados.
 *
 * Idempotente: correrlo otra vez actualiza, nunca duplica.
 *
 *   npm run db:seed-demo
 *
 * Variables opcionales: DEMO_EMAIL, DEMO_PASSWORD (si falta, se genera una y
 * se imprime), DEMO_WA_PHONE_NUMBER_ID (el phone_number_id de Meta, cuando exista).
 */

const SLUG = "demo-dealer";
const NOMBRE = "Autos Demo RD";

interface VehiculoDemo {
  readonly stock_id: string;
  readonly marca: string;
  readonly modelo: string;
  readonly anio: number;
  readonly version: string;
  readonly precio: number;
  readonly kilometraje: number;
  readonly transmision: "automatica" | "manual";
  readonly combustible: "gasolina" | "gasoil" | "hibrido";
}

const VEHICULOS: readonly VehiculoDemo[] = [
  { stock_id: "DEMO-001", marca: "Toyota", modelo: "Corolla", anio: 2020, version: "LE", precio: 1_150_000, kilometraje: 48_000, transmision: "automatica", combustible: "gasolina" },
  { stock_id: "DEMO-002", marca: "Honda", modelo: "CR-V", anio: 2019, version: "EX", precio: 1_650_000, kilometraje: 61_000, transmision: "automatica", combustible: "gasolina" },
  { stock_id: "DEMO-003", marca: "Hyundai", modelo: "Tucson", anio: 2021, version: "GL", precio: 1_480_000, kilometraje: 35_000, transmision: "automatica", combustible: "gasolina" },
  { stock_id: "DEMO-004", marca: "Kia", modelo: "Sportage", anio: 2018, version: "LX", precio: 1_090_000, kilometraje: 72_000, transmision: "automatica", combustible: "gasolina" },
  { stock_id: "DEMO-005", marca: "Toyota", modelo: "Hilux", anio: 2019, version: "SR", precio: 2_250_000, kilometraje: 80_000, transmision: "manual", combustible: "gasoil" },
  { stock_id: "DEMO-006", marca: "Nissan", modelo: "Sentra", anio: 2017, version: "S", precio: 690_000, kilometraje: 95_000, transmision: "automatica", combustible: "gasolina" },
  { stock_id: "DEMO-007", marca: "Mazda", modelo: "CX-5", anio: 2022, version: "Touring", precio: 1_950_000, kilometraje: 22_000, transmision: "automatica", combustible: "gasolina" },
  { stock_id: "DEMO-008", marca: "Toyota", modelo: "RAV4", anio: 2021, version: "Hybrid XLE", precio: 2_400_000, kilometraje: 30_000, transmision: "automatica", combustible: "hibrido" },
];

interface LeadDemo {
  readonly telefono: string;
  readonly nombre: string;
  readonly etapa: Etapa;
  readonly ficha: FichaProspecto;
  readonly documentosRecibidos: readonly DocumentoRequerido[];
  /** Documentos pedidos que todavia no llegan. */
  readonly documentosPendientes: readonly DocumentoRequerido[];
}

// Telefonos ficticios (rango 555): no pertenecen a nadie.
const LEADS: readonly LeadDemo[] = [
  {
    telefono: "18095550101",
    nombre: "Carlos Méndez",
    etapa: "nuevo",
    ficha: { nombre: "Carlos Méndez", marca_interes: "Toyota", modelo_interes: "Corolla", forma_pago: "indeciso" },
    documentosRecibidos: [],
    documentosPendientes: [],
  },
  {
    telefono: "18095550102",
    nombre: "María Rodríguez",
    etapa: "nuevo",
    ficha: { nombre: "María Rodríguez", uso: "familiar", marca_interes: "Honda", modelo_interes: "CR-V", forma_pago: "financiamiento", presupuesto_max: 1_700_000, moneda_presupuesto: "DOP" },
    documentosRecibidos: [],
    documentosPendientes: [],
  },
  {
    telefono: "18095550103",
    nombre: "José Peña",
    etapa: "calificado",
    ficha: { nombre: "José Peña", edad: 34, uso: "trabajo", forma_pago: "financiamiento", presupuesto_max: 1_500_000, moneda_presupuesto: "DOP", inicial_disponible: 350_000, ingreso_mensual: 95_000, antiguedad_laboral_meses: 40, marca_interes: "Hyundai", modelo_interes: "Tucson", anio_interes: 2021, plazo_meses: 60, tiene_intercambio: false },
    documentosRecibidos: ["cedula_frontal"],
    documentosPendientes: ["cedula_dorsal", "carta_trabajo"],
  },
  {
    telefono: "18095550104",
    nombre: "Ana Castillo",
    // La cuota queda en 36.5% del ingreso (tope 35%): el motor dice `revisar`,
    // y el copiloto solo mueve a `calificado` lo que da `califica`.
    etapa: "nuevo",
    ficha: { nombre: "Ana Castillo", edad: 29, uso: "personal", forma_pago: "financiamiento", presupuesto_max: 1_200_000, moneda_presupuesto: "DOP", inicial_disponible: 240_000, ingreso_mensual: 52_000, antiguedad_laboral_meses: 18, marca_interes: "Toyota", modelo_interes: "Corolla", anio_interes: 2020, plazo_meses: 48, tiene_intercambio: false },
    documentosRecibidos: [],
    documentosPendientes: ["cedula_frontal", "cedula_dorsal", "carta_trabajo"],
  },
  {
    telefono: "18095550105",
    nombre: "Ramón Jiménez",
    etapa: "expediente_completo",
    ficha: { nombre: "Ramón Jiménez", edad: 45, uso: "familiar", forma_pago: "financiamiento", presupuesto_max: 2_000_000, moneda_presupuesto: "DOP", inicial_disponible: 600_000, ingreso_mensual: 140_000, antiguedad_laboral_meses: 96, marca_interes: "Mazda", modelo_interes: "CX-5", anio_interes: 2022, plazo_meses: 60, tiene_intercambio: true, intercambio_descripcion: "Honda Civic 2015" },
    documentosRecibidos: ["cedula_frontal", "cedula_dorsal", "carta_trabajo"],
    documentosPendientes: [],
  },
  {
    telefono: "18095550106",
    nombre: "Luisa Fernández",
    etapa: "test_drive",
    ficha: { nombre: "Luisa Fernández", edad: 38, uso: "trabajo", forma_pago: "financiamiento", presupuesto_max: 1_700_000, moneda_presupuesto: "DOP", inicial_disponible: 400_000, ingreso_mensual: 110_000, antiguedad_laboral_meses: 60, marca_interes: "Honda", modelo_interes: "CR-V", anio_interes: 2019, plazo_meses: 60, tiene_intercambio: false },
    documentosRecibidos: ["cedula_frontal", "cedula_dorsal", "carta_trabajo"],
    documentosPendientes: [],
  },
  {
    telefono: "18095550107",
    nombre: "Pedro Almonte",
    etapa: "negociacion",
    ficha: { nombre: "Pedro Almonte", edad: 51, uso: "comercial", forma_pago: "contado", presupuesto_max: 2_300_000, moneda_presupuesto: "DOP", marca_interes: "Toyota", modelo_interes: "Hilux", anio_interes: 2019, tiene_intercambio: false },
    documentosRecibidos: ["cedula_frontal", "cedula_dorsal"],
    documentosPendientes: [],
  },
  {
    telefono: "18095550108",
    nombre: "Yesenia Batista",
    etapa: "nuevo",
    ficha: { nombre: "Yesenia Batista", edad: 24, uso: "personal", forma_pago: "financiamiento", presupuesto_max: 700_000, moneda_presupuesto: "DOP", inicial_disponible: 40_000, ingreso_mensual: 30_000, antiguedad_laboral_meses: 5, marca_interes: "Nissan", modelo_interes: "Sentra", anio_interes: 2017, plazo_meses: 48, tiene_intercambio: false },
    documentosRecibidos: [],
    documentosPendientes: [],
  },
];

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (valor === undefined || valor === "" || valor.includes("xxxxxxxx") || valor === "eyJ...") {
    throw new Error(`Falta ${nombre} en .env.local`);
  }
  return valor;
}

function exigir<T>(resultado: { data: T | null; error: { message: string } | null }, que: string): T {
  if (resultado.error !== null) throw new Error(`${que}: ${resultado.error.message}`);
  if (resultado.data === null) throw new Error(`${que}: sin datos`);
  return resultado.data;
}

async function asegurarUsuario(db: SupabaseClient, email: string, password: string): Promise<string> {
  // listUsers pagina de a 50 por defecto; un proyecto de demo no pasa de ahi,
  // pero se pide la pagina grande para no crear un duplicado por paginacion.
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error !== null) throw new Error(`No se pudieron listar usuarios: ${error.message}`);

  const existente = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existente !== undefined) {
    const { error: errUpd } = await db.auth.admin.updateUserById(existente.id, { password });
    if (errUpd !== null) throw new Error(`No se pudo actualizar la clave: ${errUpd.message}`);
    return existente.id;
  }

  const { data: creado, error: errCrear } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (errCrear !== null) throw new Error(`No se pudo crear el usuario: ${errCrear.message}`);
  return creado.user.id;
}

async function main(): Promise<void> {
  const db = createClient(requerida("NEXT_PUBLIC_SUPABASE_URL"), requerida("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = process.env["DEMO_EMAIL"] ?? "demo@autosdemo.test";
  const passwordDada = process.env["DEMO_PASSWORD"];
  const password = passwordDada ?? randomBytes(9).toString("base64url");
  const waPhoneNumberId = process.env["DEMO_WA_PHONE_NUMBER_ID"] ?? "demo-sin-numero";

  const reglas: TenantRules = parseTenantRules(
    JSON.parse(readFileSync(new URL("../config/tenants/demo-dealer.json", import.meta.url), "utf8")),
  );

  // ── Dealer ────────────────────────────────────────────────────────────────
  const tenant = exigir(
    await db
      .from("tenants")
      .upsert(
        { slug: SLUG, nombre: NOMBRE, wa_phone_number_id: waPhoneNumberId, activo: true },
        { onConflict: "slug" },
      )
      .select("id")
      .single<{ id: string }>(),
    "Dealer",
  );
  const tenantId = tenant.id;

  // ── Ruleset vigente ───────────────────────────────────────────────────────
  // Se apagan los demas antes de encender este: el indice unico parcial solo
  // admite un vigente por dealer.
  await db
    .from("prequalification_rulesets")
    .update({ vigente: false })
    .eq("tenant_id", tenantId)
    .neq("version", reglas.version);
  const ruleset = exigir(
    await db
      .from("prequalification_rulesets")
      .upsert(
        { tenant_id: tenantId, version: reglas.version, reglas, vigente: true },
        { onConflict: "tenant_id,version" },
      )
      .select("id")
      .single<{ id: string }>(),
    "Ruleset",
  );

  // ── Plan ──────────────────────────────────────────────────────────────────
  exigir(
    await db
      .from("tenant_plan")
      .upsert(
        {
          tenant_id: tenantId,
          base_conversaciones_atendidas: 300,
          base_recordatorios: 200,
          base_reactivaciones: 100,
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      )
      .select("tenant_id"),
    "Plan",
  );

  // ── Usuario del dealer ────────────────────────────────────────────────────
  const userId = await asegurarUsuario(db, email, password);
  exigir(
    await db
      .from("tenant_members")
      .upsert({ tenant_id: tenantId, user_id: userId, rol: "owner" }, { onConflict: "tenant_id,user_id" })
      .select("user_id"),
    "Membresia",
  );

  // ── Inventario ────────────────────────────────────────────────────────────
  exigir(
    await db
      .from("vehicles")
      .upsert(
        VEHICULOS.map((v) => ({ ...v, tenant_id: tenantId, moneda: "DOP", disponible: true })),
        { onConflict: "tenant_id,stock_id" },
      )
      .select("id"),
    "Inventario",
  );

  // ── Prospectos ────────────────────────────────────────────────────────────
  const retenerHasta = new Date();
  retenerHasta.setDate(retenerHasta.getDate() + reglas.retencion_documentos_dias);
  const retener = retenerHasta.toISOString().slice(0, 10);

  for (const [i, demo] of LEADS.entries()) {
    const vehiculo = VEHICULOS.find(
      (v) => v.marca === demo.ficha.marca_interes && v.modelo === demo.ficha.modelo_interes,
    );
    const resultado = evaluarPrecalificacion({
      ficha: demo.ficha,
      reglas,
      vehiculo:
        vehiculo === undefined
          ? undefined
          : { precio: vehiculo.precio, moneda: "DOP", marca: vehiculo.marca, anio: vehiculo.anio },
      documentosRecibidos: demo.documentosRecibidos,
    });
    // Los mas avanzados en el tablero aparecen como movidos mas recientemente.
    const actualizado = new Date(Date.now() - (LEADS.length - i) * 3_600_000).toISOString();

    const lead = exigir(
      await db
        .from("leads")
        .upsert(
          {
            tenant_id: tenantId,
            telefono: demo.telefono,
            nombre: demo.nombre,
            etapa: demo.etapa,
            temperatura: temperaturaDe(resultado),
            ficha: demo.ficha,
            actualizado_en: actualizado,
          },
          { onConflict: "tenant_id,telefono" },
        )
        .select("id")
        .single<{ id: string }>(),
      `Lead ${demo.nombre}`,
    );

    // Resultado y expediente se reemplazan completos: asi re-sembrar no apila
    // semaforos viejos ni choca con el indice unico parcial de documentos.
    await db.from("qualification_results").delete().eq("tenant_id", tenantId).eq("lead_id", lead.id);
    await db.from("lead_documents").delete().eq("tenant_id", tenantId).eq("lead_id", lead.id);

    // El semaforo es un pre-filtro de financiamiento: a quien paga de contado
    // o aun no decide no se le evalua.
    if (demo.ficha.forma_pago === "financiamiento") {
      exigir(
        await db
          .from("qualification_results")
          .insert({
            tenant_id: tenantId,
            lead_id: lead.id,
            ruleset_id: ruleset.id,
            resultado: resultado.resultado,
            detalle: resultado.detalle,
            faltantes: resultado.faltantes,
          })
          .select("id"),
        `Semaforo ${demo.nombre}`,
      );
    }

    // Sin binario en Storage: son filas de muestra para el checklist del
    // tablero, no documentos reales.
    const documentos = [
      ...demo.documentosRecibidos.map((tipo) => ({ tipo, estado: "recibido" as const })),
      ...demo.documentosPendientes.map((tipo) => ({ tipo, estado: "pendiente" as const })),
    ];
    if (documentos.length > 0) {
      exigir(
        await db
          .from("lead_documents")
          .insert(
            documentos.map((d) => ({
              tenant_id: tenantId,
              lead_id: lead.id,
              tipo: d.tipo,
              estado: d.estado,
              retener_hasta: retener,
            })),
          )
          .select("id"),
        `Expediente ${demo.nombre}`,
      );
    }

    console.log(`  · ${demo.nombre.padEnd(18)} ${demo.etapa.padEnd(20)} ${resultado.resultado}`);
  }

  console.log(`
Dealer de ejemplo listo: ${NOMBRE} (${SLUG})
  tenant_id           ${tenantId}
  wa_phone_number_id  ${waPhoneNumberId}
  ruleset vigente     v${reglas.version}
  inventario          ${VEHICULOS.length} vehiculos
  prospectos          ${LEADS.length}

Acceso al tablero (http://localhost:3000/login)
  correo  ${email}
  clave   ${passwordDada === undefined ? `${password}   <- generada; guardala o fija DEMO_PASSWORD` : "(la de DEMO_PASSWORD)"}
`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
