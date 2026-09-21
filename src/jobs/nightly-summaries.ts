import Anthropic from "@anthropic-ai/sdk";
import { anthropic, modelo } from "../agent/client.js";
import { serviceClient } from "../connectors/supabase.js";
import { logger } from "../lib/logger.js";

/**
 * Resumenes nocturnos de leads, por Batch API.
 *
 * Nada de esto es tiempo real: el vendedor lee el resumen por la mañana. La
 * Batch API cuesta la mitad, asi que todo lo que no tiene a alguien esperando
 * del otro lado va por aqui y no por el endpoint sincrono.
 *
 * Uso: `npm run batch:nightly`
 */

const PROMPT_RESUMEN =
  "Resume esta conversacion de WhatsApp para el vendedor que la va a retomar. " +
  "Tres lineas maximo: que busca, en que quedo, y cual es el siguiente paso concreto. " +
  "No repitas datos que ya estan en la ficha. No inventes nada que no este en la conversacion.";

interface ConversacionPendiente {
  readonly id: string;
  readonly tenant_id: string;
  readonly lead_id: string;
}

export async function encolarResumenes(): Promise<{ batchId: string; total: number } | null> {
  const db = serviceClient();

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: conversaciones, error } = await db
    .from("conversations")
    .select("id, tenant_id, lead_id")
    .in("estado", ["calificada", "escalada"])
    .gte("creado_en", desde)
    .limit(500)
    .returns<ConversacionPendiente[]>();

  if (error !== null) throw new Error(`No se pudieron listar conversaciones: ${error.message}`);
  if (conversaciones === null || conversaciones.length === 0) {
    logger.info("No hay conversaciones para resumir esta noche");
    return null;
  }

  const solicitudes: Anthropic.Messages.Batches.BatchCreateParams.Request[] = [];

  for (const conversacion of conversaciones) {
    const { data: mensajes } = await db
      .from("messages")
      .select("rol, cuerpo")
      .eq("tenant_id", conversacion.tenant_id)
      .eq("conversation_id", conversacion.id)
      .order("creado_en", { ascending: true })
      .limit(40);

    if (mensajes === null || mensajes.length === 0) continue;

    const transcripcion = mensajes
      .map((m) => `${m.rol === "user" ? "Cliente" : "Copiloto"}: ${m.cuerpo}`)
      .join("\n");

    solicitudes.push({
      // El custom_id es la unica forma de reasociar: los resultados vuelven en
      // cualquier orden, nunca por posicion.
      custom_id: `conv-${conversacion.id}`,
      params: {
        model: modelo(),
        max_tokens: 300,
        system: PROMPT_RESUMEN,
        messages: [{ role: "user", content: transcripcion }],
      },
    });
  }

  if (solicitudes.length === 0) {
    logger.info("Conversaciones sin mensajes: nada que encolar");
    return null;
  }

  const batch = await anthropic().messages.batches.create({ requests: solicitudes });

  logger.info(
    { batch_id: batch.id, total: solicitudes.length, estado: batch.processing_status },
    "Lote nocturno de resumenes encolado",
  );

  return { batchId: batch.id, total: solicitudes.length };
}

/**
 * Recoge un lote ya terminado y guarda cada resumen en la ficha de su lead.
 * Se corre en una segunda pasada: la Batch API tarda hasta 24h.
 */
export async function recogerResumenes(batchId: string): Promise<number> {
  const db = serviceClient();
  const client = anthropic();

  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") {
    logger.info({ batch_id: batchId, estado: batch.processing_status }, "El lote sigue corriendo");
    return 0;
  }

  let guardados = 0;
  for await (const entrada of await client.messages.batches.results(batchId)) {
    if (entrada.result.type !== "succeeded") {
      logger.warn({ custom_id: entrada.custom_id, tipo: entrada.result.type }, "Resumen fallido");
      continue;
    }

    const texto = entrada.result.message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const conversacionId = entrada.custom_id.replace(/^conv-/, "");

    const { data: conversacion } = await db
      .from("conversations")
      .select("tenant_id, lead_id")
      .eq("id", conversacionId)
      .maybeSingle<{ tenant_id: string; lead_id: string }>();

    if (conversacion === null || conversacion === undefined) continue;

    const { data: lead } = await db
      .from("leads")
      .select("ficha")
      .eq("tenant_id", conversacion.tenant_id)
      .eq("id", conversacion.lead_id)
      .maybeSingle<{ ficha: Record<string, unknown> }>();

    await db
      .from("leads")
      .update({ ficha: { ...(lead?.ficha ?? {}), notas: texto } })
      .eq("tenant_id", conversacion.tenant_id)
      .eq("id", conversacion.lead_id);

    guardados += 1;
  }

  logger.info({ batch_id: batchId, guardados }, "Resumenes nocturnos aplicados");
  return guardados;
}

// Entrada de CLI: `npm run batch:nightly` encola; con un id, recoge.
if (process.argv[1] !== undefined && process.argv[1].endsWith("nightly-summaries.ts")) {
  const batchId = process.argv[2];
  const tarea = batchId === undefined ? encolarResumenes() : recogerResumenes(batchId);
  tarea.catch((error: unknown) => {
    logger.error({ error }, "El job nocturno fallo");
    process.exitCode = 1;
  });
}
