import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv, publicEnv } from "../config/env.js";

/**
 * Clientes de Supabase.
 *
 * Dos clientes, dos niveles de confianza:
 *
 *  - `browserClient` usa la anon key y respeta RLS. Es el que ve el dealer:
 *    el aislamiento entre tenants lo hace el motor, no la aplicacion.
 *
 *  - `serviceClient` usa la service role key y **salta RLS**. Solo el webhook
 *    y los jobs lo usan, solo en el servidor, y siempre filtrando por
 *    tenant_id a mano. Si esta llave llega al navegador, el aislamiento entre
 *    dealers desaparece por completo.
 */

let servicio: SupabaseClient | null = null;

/**
 * Cliente con service role. Nunca importar desde un componente de cliente.
 *
 * @throws Error si se invoca en el navegador.
 */
export function serviceClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "serviceClient() es solo de servidor: la service role key salta RLS y no puede llegar al navegador",
    );
  }
  if (servicio !== null) return servicio;

  const env = serverEnv();
  servicio = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return servicio;
}

/** Cliente para el navegador: anon key, RLS activa. */
export function browserClient(): SupabaseClient {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Guarda de tenancy para todo acceso hecho con service role.
 *
 * Como esa llave salta RLS, el filtro por tenant queda en manos del codigo.
 * Esta funcion existe para que ese filtro sea explicito y revisable en el
 * diff, en vez de estar implicito en cada consulta.
 */
export function asegurarTenant(tenantId: string): string {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(tenantId)) {
    throw new Error(`tenant_id invalido: toda consulta con service role exige un tenant valido`);
  }
  return tenantId;
}
