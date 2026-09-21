import { z } from "zod";

/**
 * Cargador de configuracion tipado. Ninguna credencial ni parametro de negocio
 * se escribe a mano en el codigo: todo entra por aqui y se valida al arrancar,
 * para que un valor faltante falle en el despliegue y no en el primer lead.
 */

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  ANTHROPIC_API_KEY: z.string().min(1, "falta ANTHROPIC_API_KEY"),
  // Decision del brief: Haiku 4.5. El trabajo es extraccion + tool calling.
  // Prohibida la cascada Haiku->Sonnet: las caches son model-scoped y la
  // cascada pierde la reutilizacion de cache (~30% de la entrada).
  COPILOT_MODEL: z.string().min(1).default("claude-haiku-4-5"),
  PROMPT_VERSION: z.string().regex(/^v\d+$/).default("v1"),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DOCS_BUCKET: z.string().min(1).default("expedientes"),

  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v21.0"),

  MAX_TURNS_PER_CONVERSATION: z.coerce.number().int().positive().default(25),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/**
 * Lee y valida el entorno del servidor. Se memoiza: el esquema se evalua una
 * sola vez por proceso.
 *
 * @throws Error legible que enumera cada variable invalida o ausente.
 */
export function serverEnv(): ServerEnv {
  if (cached !== null) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuracion de entorno invalida:\n${detalle}`);
  }

  cached = parsed.data;
  return cached;
}

/** Configuracion publica: lo unico que puede cruzar al navegador. */
export function publicEnv(): { supabaseUrl: string; supabaseAnonKey: string } {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (url === undefined || key === undefined) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return { supabaseUrl: url, supabaseAnonKey: key };
}
