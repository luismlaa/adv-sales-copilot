import { NextResponse } from "next/server";
import { firmaValida, normalizarWebhook } from "@/connectors/whatsapp";
import { manejarMensajeEntrante } from "@/orchestrator/handle-inbound";
import { serverEnv } from "@/config/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook de WhatsApp Cloud API.
 *
 * Dos invariantes que no se negocian:
 *
 *  1. **Se valida la firma sobre el cuerpo crudo.** Sin eso, cualquiera que
 *     conozca la URL inyecta leads y mensajes en la base de un dealer.
 *  2. **Se responde 200 antes de procesar.** Meta reintenta lo que tarda; un
 *     reintento con el mismo wa_message_id se descarta por clave unica, pero
 *     lo barato es no provocarlo.
 */

/** Handshake de verificacion de Meta. */
export function GET(request: Request): NextResponse {
  const url = new URL(request.url);
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (modo === "subscribe" && token === serverEnv().WHATSAPP_VERIFY_TOKEN && challenge !== null) {
    return new NextResponse(challenge, { status: 200 });
  }
  logger.warn("Handshake de webhook rechazado: verify_token no coincide");
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const cuerpoCrudo = await request.text();

  if (!firmaValida(cuerpoCrudo, request.headers.get("x-hub-signature-256"))) {
    logger.warn("Webhook con firma invalida: descartado");
    return new NextResponse("invalid signature", { status: 401 });
  }

  let mensajes;
  try {
    mensajes = normalizarWebhook(JSON.parse(cuerpoCrudo));
  } catch (error) {
    // Payload con forma inesperada: 200 igual, para que Meta no reintente algo
    // que nunca va a poder procesarse.
    logger.error({ error }, "Payload de webhook no reconocido");
    return NextResponse.json({ ok: true });
  }

  // Procesamiento en segundo plano; la respuesta a Meta no lo espera.
  void Promise.all(
    mensajes.map(async (m) => {
      try {
        await manejarMensajeEntrante(m);
      } catch (error) {
        logger.error(
          { error, wa_message_id: m.waMessageId },
          "Fallo el procesamiento de un mensaje entrante",
        );
      }
    }),
  );

  return NextResponse.json({ ok: true });
}
