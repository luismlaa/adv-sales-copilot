import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serverEnv } from "@/config/env";
import { logger } from "@/lib/logger";

/**
 * Cliente de WhatsApp Cloud API (oficial, Meta).
 *
 * WAHA y otros puentes no oficiales quedan fuera de produccion: el riesgo de
 * baneo del numero del dealer no es asumible. Solo para demos.
 */

/** ── Verificacion de firma ───────────────────────────────────────────────── */

/**
 * Valida la firma `X-Hub-Signature-256` sobre el cuerpo **crudo** del webhook.
 *
 * Sin esto, cualquiera que conozca la URL puede inyectar leads y mensajes en
 * la base de un dealer. Se compara en tiempo constante.
 *
 * @param cuerpoCrudo el body exacto tal como llego, sin reserializar
 */
export function firmaValida(cuerpoCrudo: string, cabecera: string | null): boolean {
  if (cabecera === null || !cabecera.startsWith("sha256=")) return false;

  const esperado = createHmac("sha256", serverEnv().WHATSAPP_APP_SECRET)
    .update(cuerpoCrudo, "utf8")
    .digest("hex");
  const recibido = cabecera.slice("sha256=".length);

  const a = Buffer.from(esperado, "hex");
  const b = Buffer.from(recibido, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** ── Forma del webhook entrante ──────────────────────────────────────────── */

const mensajeEntranteSchema = z.object({
  from: z.string().min(1),
  id: z.string().min(1),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  document: z
    .object({ id: z.string(), mime_type: z.string().optional(), filename: z.string().optional() })
    .optional(),
});

const webhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            metadata: z.object({
              phone_number_id: z.string(),
              display_phone_number: z.string(),
            }),
            contacts: z
              .array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }) }))
              .optional(),
            messages: z.array(mensajeEntranteSchema).optional(),
            statuses: z.array(z.object({ id: z.string(), status: z.string() })).optional(),
          }),
        }),
      ),
    }),
  ),
});

export type WebhookPayload = z.infer<typeof webhookSchema>;
export type MensajeEntrante = z.infer<typeof mensajeEntranteSchema>;

export interface MensajeNormalizado {
  readonly waMessageId: string;
  readonly telefono: string;
  readonly nombrePerfil: string | undefined;
  readonly phoneNumberId: string;
  readonly recibidoEn: Date;
  readonly contenido:
    | { readonly tipo: "texto"; readonly texto: string }
    | { readonly tipo: "media"; readonly mediaId: string; readonly mime: string | undefined }
    | { readonly tipo: "no_soportado"; readonly original: string };
}

/**
 * Convierte el payload de Meta en mensajes planos.
 *
 * Devuelve `[]` para notificaciones de estado (entregado, leido) y para
 * cualquier evento que no sea un mensaje: el webhook debe responder 200 a
 * todo, pero solo procesamos lo que es una conversacion.
 *
 * @throws ZodError si el payload no tiene la forma documentada por Meta.
 */
export function normalizarWebhook(raw: unknown): MensajeNormalizado[] {
  const payload = webhookSchema.parse(raw);
  const salida: MensajeNormalizado[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { metadata, messages, contacts } = change.value;
      if (messages === undefined) continue;

      const nombre = contacts?.[0]?.profile.name;

      for (const m of messages) {
        salida.push({
          waMessageId: m.id,
          telefono: m.from,
          nombrePerfil: nombre,
          phoneNumberId: metadata.phone_number_id,
          recibidoEn: new Date(Number(m.timestamp) * 1000),
          contenido: contenidoDe(m),
        });
      }
    }
  }

  return salida;
}

function contenidoDe(m: MensajeEntrante): MensajeNormalizado["contenido"] {
  if (m.type === "text" && m.text !== undefined) {
    return { tipo: "texto", texto: m.text.body };
  }
  if (m.type === "image" && m.image !== undefined) {
    return { tipo: "media", mediaId: m.image.id, mime: m.image.mime_type };
  }
  if (m.type === "document" && m.document !== undefined) {
    return { tipo: "media", mediaId: m.document.id, mime: m.document.mime_type };
  }
  return { tipo: "no_soportado", original: m.type };
}

/** ── Salida ──────────────────────────────────────────────────────────────── */

function graphUrl(path: string): string {
  const env = serverEnv();
  return `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${path}`;
}

async function postGraph(path: string, body: unknown): Promise<{ messageId: string }> {
  const env = serverEnv();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);

  try {
    const res = await fetch(graphUrl(path), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    const json: unknown = await res.json();
    if (!res.ok) {
      logger.error({ status: res.status, respuesta: json }, "WhatsApp Cloud API rechazo el envio");
      throw new Error(`WhatsApp respondio ${res.status}`);
    }

    const parsed = z
      .object({ messages: z.array(z.object({ id: z.string() })).min(1) })
      .parse(json);
    // `messages` tiene minimo 1 elemento por el esquema; el indice es seguro.
    return { messageId: parsed.messages[0]!.id };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Responde dentro de la ventana de 24h. Gratis: Meta no cobra las respuestas
 * de servicio. Nunca usar esta via fuera de la ventana — el envio falla.
 */
export async function enviarRespuesta(
  telefono: string,
  texto: string,
): Promise<{ messageId: string }> {
  const env = serverEnv();
  return postGraph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: telefono,
    type: "text",
    text: { preview_url: false, body: texto },
  });
}

/**
 * Envia una plantilla aprobada. **Esto se factura** y consume contador:
 * `utility` -> recordatorios, `marketing` -> reactivaciones.
 *
 * Quien llama es responsable de registrar el evento de consumo con el
 * `messageId` devuelto como clave de idempotencia.
 */
export async function enviarPlantilla(
  telefono: string,
  plantilla: string,
  idioma: string,
  parametros: readonly string[],
): Promise<{ messageId: string }> {
  const env = serverEnv();
  return postGraph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: telefono,
    type: "template",
    template: {
      name: plantilla,
      language: { code: idioma },
      components:
        parametros.length === 0
          ? []
          : [
              {
                type: "body",
                parameters: parametros.map((p) => ({ type: "text", text: p })),
              },
            ],
    },
  });
}

/** Descarga un archivo que el prospecto subio por el chat (cedula, carta). */
export async function descargarMedia(mediaId: string): Promise<{ bytes: Buffer; mime: string }> {
  const env = serverEnv();
  const metaRes = await fetch(graphUrl(mediaId), {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`No se pudo leer el media ${mediaId}`);

  const meta = z
    .object({ url: z.string().url(), mime_type: z.string() })
    .parse(await metaRes.json());

  const binRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!binRes.ok) throw new Error(`No se pudo descargar el media ${mediaId}`);

  return { bytes: Buffer.from(await binRes.arrayBuffer()), mime: meta.mime_type };
}
