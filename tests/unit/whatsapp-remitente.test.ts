import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regresion de multi-tenancy.
 *
 * El remitente de una respuesta DEBE ser el numero del dealer al que el cliente
 * escribio, no un numero fijo de configuracion. Con un numero fijo, el cliente
 * del Dealer B recibiria la respuesta desde el numero del Dealer A: un cruce
 * entre tenants visible para el cliente final.
 */

const ENV_BASE = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  WHATSAPP_ACCESS_TOKEN: "token",
  WHATSAPP_VERIFY_TOKEN: "verify",
  WHATSAPP_APP_SECRET: "secret",
  WHATSAPP_GRAPH_VERSION: "v21.0",
};

let urlsLlamadas: string[] = [];

beforeEach(() => {
  urlsLlamadas = [];
  Object.assign(process.env, ENV_BASE);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      urlsLlamadas.push(String(url));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.TEST" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remitente por tenant", () => {
  it("responde desde el numero que se le pasa, no desde uno de configuracion", async () => {
    const { enviarRespuesta } = await import("@/connectors/whatsapp");

    await enviarRespuesta("DEALER_A_111", "18090000001", "hola");
    await enviarRespuesta("DEALER_B_222", "18090000002", "hola");

    expect(urlsLlamadas[0]).toContain("/DEALER_A_111/messages");
    expect(urlsLlamadas[1]).toContain("/DEALER_B_222/messages");
  });

  it("una plantilla tambien sale desde el numero del dealer", async () => {
    const { enviarPlantilla } = await import("@/connectors/whatsapp");

    await enviarPlantilla("DEALER_C_333", "18090000003", "recordatorio", "es", ["Luis"]);

    expect(urlsLlamadas[0]).toContain("/DEALER_C_333/messages");
  });

  it("el numero remitente no puede venir del entorno", async () => {
    // Si alguien reintroduce WHATSAPP_PHONE_NUMBER_ID como fuente del
    // remitente, el producto vuelve a ser mono-tenant sin avisar.
    const { serverEnv } = await import("@/config/env");
    expect(Object.keys(serverEnv())).not.toContain("WHATSAPP_PHONE_NUMBER_ID");
  });
});
