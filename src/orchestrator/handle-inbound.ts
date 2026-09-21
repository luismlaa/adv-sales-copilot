import type Anthropic from "@anthropic-ai/sdk";
import { serviceClient } from "../connectors/supabase.js";
import {
  enviarRespuesta,
  descargarMedia,
  type MensajeNormalizado,
} from "../connectors/whatsapp.js";
import { correrTurno } from "../agent/run-turn.js";
import { crearPuertos } from "./ports.js";
import { parseTenantRules } from "../schemas/tenant-rules.js";
import { expiraEn, modoDeSalida } from "../domain/conversation-window.js";
import { periodoDe, claveIdempotencia } from "../domain/usage.js";
import { serverEnv } from "../config/env.js";
import { logAccion, logger } from "../lib/logger.js";
import { tasaCache } from "../agent/client.js";

/**
 * Orquestacion de un mensaje entrante.
 *
 * Diseñado para entrante: este flujo **responde**, nunca inicia. Meta no cobra
 * las respuestas dentro de la ventana de 24h que abre el cliente; todo lo que
 * iniciamos nosotros si se cobra y consume contador.
 *
 * El webhook ya contesto 200 antes de llamar aqui: Meta reintenta si tarda, y
 * un reintento con el mismo `wa_message_id` se descarta por la clave unica de
 * `messages`.
 */

const MAX_HISTORIAL = 20;

interface Tenant {
  readonly id: string;
  readonly nombre: string;
  readonly zona_horaria: string;
}

export async function manejarMensajeEntrante(mensaje: MensajeNormalizado): Promise<void> {
  const db = serviceClient();

  // ── 1 · Resolver el dealer por el numero que recibio el mensaje ──────────
  const { data: tenant } = await db
    .from("tenants")
    .select("id, nombre, zona_horaria")
    .eq("telefono_wa", mensaje.phoneNumberId)
    .eq("activo", true)
    .maybeSingle<Tenant>();

  if (tenant === null || tenant === undefined) {
    logger.warn(
      { phone_number_id: mensaje.phoneNumberId },
      "Mensaje para un numero sin dealer activo: se descarta",
    );
    return;
  }
  const tenantId = tenant.id;

  // ── 2 · Lead (uno por telefono y dealer) ─────────────────────────────────
  const { data: lead, error: errLead } = await db
    .from("leads")
    .upsert(
      {
        tenant_id: tenantId,
        telefono: mensaje.telefono,
        nombre: mensaje.nombrePerfil ?? null,
      },
      { onConflict: "tenant_id,telefono", ignoreDuplicates: false },
    )
    .select("id, etapa")
    .single();
  if (errLead !== null) throw new Error(`No se pudo registrar el lead: ${errLead.message}`);

  // ── 3 · Conversacion abierta + ventana de 24h ────────────────────────────
  const ventana = expiraEn(mensaje.recibidoEn).toISOString();

  const { data: abierta } = await db
    .from("conversations")
    .select("id, turnos, estado, contabilizada_en")
    .eq("tenant_id", tenantId)
    .eq("lead_id", lead.id)
    .in("estado", ["abierta", "escalada"])
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversacionId: string;
  let turnos: number;
  if (abierta === null || abierta === undefined) {
    const { data: nueva, error } = await db
      .from("conversations")
      .insert({ tenant_id: tenantId, lead_id: lead.id, ventana_expira_en: ventana })
      .select("id")
      .single();
    if (error !== null) throw new Error(`No se pudo abrir conversacion: ${error.message}`);
    conversacionId = nueva.id;
    turnos = 0;
  } else {
    conversacionId = abierta.id;
    turnos = abierta.turnos;
    await db
      .from("conversations")
      .update({ ventana_expira_en: ventana })
      .eq("tenant_id", tenantId)
      .eq("id", conversacionId);
  }

  // ── 4 · Idempotencia: el mismo wa_message_id nunca se procesa dos veces ──
  const cuerpo = await textoDelMensaje(mensaje, tenantId, lead.id);

  const { error: errMensaje } = await db.from("messages").insert({
    tenant_id: tenantId,
    conversation_id: conversacionId,
    direccion: "entrante",
    rol: "user",
    cuerpo,
    wa_message_id: mensaje.waMessageId,
  });
  if (errMensaje !== null) {
    // 23505 = violacion de unicidad: es un reintento de Meta, no un error.
    if (errMensaje.code === "23505") {
      logger.info({ wa_message_id: mensaje.waMessageId }, "Reintento de Meta: ya procesado");
      return;
    }
    throw new Error(`No se pudo guardar el mensaje: ${errMensaje.message}`);
  }

  // ── 5 · Tope de turnos: a partir de aqui cierra una persona ──────────────
  if (turnos >= serverEnv().MAX_TURNS_PER_CONVERSATION) {
    await db
      .from("conversations")
      .update({ estado: "escalada" })
      .eq("tenant_id", tenantId)
      .eq("id", conversacionId);
    logAccion({
      tenantId,
      actor: "sistema",
      accion: "escalado_por_limite",
      entidad: "conversacion",
      entidadId: conversacionId,
      motivo: `La conversacion supero ${turnos} turnos sin cerrar`,
    });
    return;
  }

  // ── 6 · Reglas vigentes del dealer ───────────────────────────────────────
  const { data: ruleset } = await db
    .from("prequalification_rulesets")
    .select("id, reglas")
    .eq("tenant_id", tenantId)
    .eq("vigente", true)
    .single();
  if (ruleset === null || ruleset === undefined) {
    throw new Error(`El dealer ${tenantId} no tiene reglas de pre-calificacion vigentes`);
  }
  const reglas = parseTenantRules(ruleset.reglas);

  // ── 7 · Historial ────────────────────────────────────────────────────────
  const { data: previos } = await db
    .from("messages")
    .select("rol, cuerpo")
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversacionId)
    .neq("wa_message_id", mensaje.waMessageId)
    .order("creado_en", { ascending: false })
    .limit(MAX_HISTORIAL);

  const historial: Anthropic.MessageParam[] = (previos ?? [])
    .reverse()
    .map((m) => ({ role: m.rol as "user" | "assistant", content: m.cuerpo }));

  // ── 8 · Turno ────────────────────────────────────────────────────────────
  const puertos = crearPuertos(db, {
    tenantId,
    leadId: lead.id,
    reglas,
    rulesetId: ruleset.id,
  });

  const resultado = await correrTurno(
    {
      dealer: {
        nombre: tenant.nombre,
        horario: "lunes a sabado, 8:00 am a 6:00 pm",
        direccion: "consultar con el vendedor",
      },
      reglas,
      historial,
      mensajeEntrante: cuerpo,
    },
    puertos,
  );

  logger.info(
    {
      tenant_id: tenantId,
      conversacion: conversacionId,
      herramientas: resultado.herramientasUsadas,
      tokens: resultado.uso,
      cache_hit: Number(tasaCache(resultado.uso).toFixed(2)),
    },
    "Turno de calificacion completado",
  );

  // ── 9 · Salida: solo si la ventana sigue abierta ─────────────────────────
  const modo = modoDeSalida(new Date(ventana), new Date(), "respuesta");
  if (modo.tipo !== "servicio") {
    logger.warn(
      { conversacion: conversacionId },
      "La ventana de 24h cerro durante el turno: no se responde para no facturar una plantilla sin decision humana",
    );
    return;
  }

  const enviado = await enviarRespuesta(mensaje.telefono, resultado.respuesta);

  await db.from("messages").insert({
    tenant_id: tenantId,
    conversation_id: conversacionId,
    direccion: "saliente",
    rol: "assistant",
    cuerpo: resultado.respuesta,
    wa_message_id: enviado.messageId,
    categoria: "servicio",
  });

  await db
    .from("conversations")
    .update({ turnos: turnos + 1, estado: resultado.escalado ? "escalada" : "abierta" })
    .eq("tenant_id", tenantId)
    .eq("id", conversacionId);

  // ── 10 · Consumo: la conversacion se cuenta UNA vez, al completarse ──────
  const completada = resultado.herramientasUsadas.includes("evaluar_precalificacion");
  const yaContabilizada = abierta?.contabilizada_en ?? null;
  if (completada && yaContabilizada === null) {
    await registrarConversacionAtendida(db, tenantId, tenant.zona_horaria, conversacionId);
  }
}

/** Texto que entra al modelo. Los adjuntos se guardan, no se leen. */
async function textoDelMensaje(
  mensaje: MensajeNormalizado,
  tenantId: string,
  leadId: string,
): Promise<string> {
  if (mensaje.contenido.tipo === "texto") return mensaje.contenido.texto;

  if (mensaje.contenido.tipo === "media") {
    // Decision abierta #1 del brief, resuelta por ahora en "solo almacenar":
    // el documento se guarda cifrado en Storage y lo mira el vendedor. No
    // entra dato de identidad al modelo. Si mas adelante se lee por vision,
    // hay que medir Haiku vs Sonnet 5 en extraccion de cedula antes de elegir.
    await guardarAdjunto(mensaje.contenido.mediaId, tenantId, leadId);
    return "[El cliente envio una foto o documento. Se guardo en el expediente; agradecele y sigue.]";
  }

  return `[El cliente envio un mensaje de tipo ${mensaje.contenido.original}, que no podemos leer. Pidele que lo escriba.]`;
}

async function guardarAdjunto(
  mediaId: string,
  tenantId: string,
  leadId: string,
): Promise<void> {
  const db = serviceClient();
  const env = serverEnv();
  const { bytes, mime } = await descargarMedia(mediaId);

  const ruta = `${tenantId}/${leadId}/${mediaId}`;
  const { error } = await db.storage.from(env.SUPABASE_DOCS_BUCKET).upload(ruta, bytes, {
    contentType: mime,
    upsert: true,
  });
  if (error !== null) throw new Error(`No se pudo guardar el adjunto: ${error.message}`);

  logAccion({
    tenantId,
    actor: "sistema",
    accion: "documento_recibido",
    entidad: "lead",
    entidadId: leadId,
    motivo: "El prospecto subio un documento por el chat",
    metadata: { mime, bytes: bytes.byteLength },
  });
}

/** Inserta el evento facturable. El trigger de la base actualiza el agregado. */
async function registrarConversacionAtendida(
  db: ReturnType<typeof serviceClient>,
  tenantId: string,
  zonaHoraria: string,
  conversacionId: string,
): Promise<void> {
  const ahora = new Date();
  const { error } = await db.from("usage_events").insert({
    tenant_id: tenantId,
    contador: "conversaciones_atendidas",
    periodo: periodoDe(ahora, zonaHoraria),
    cantidad: 1,
    idempotency_key: claveIdempotencia("conversaciones_atendidas", conversacionId),
    referencia: { conversation_id: conversacionId },
  });

  // 23505 = ya contabilizada. Es el resultado correcto, no un fallo.
  if (error !== null && error.code !== "23505") {
    throw new Error(`No se pudo registrar el consumo: ${error.message}`);
  }

  await db
    .from("conversations")
    .update({ contabilizada_en: ahora.toISOString(), estado: "calificada" })
    .eq("tenant_id", tenantId)
    .eq("id", conversacionId)
    .is("contabilizada_en", null);
}
