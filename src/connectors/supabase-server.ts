import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "../config/env.js";

/**
 * Cliente de Supabase con la sesion del dealer.
 *
 * Es el cliente por defecto de todo lo que el dealer ve o toca: usa la anon
 * key, arrastra el JWT del usuario y por tanto **respeta RLS**. Un bug de
 * tenancy en la aplicacion no alcanza para leer datos de otro dealer, porque
 * el filtro lo aplica Postgres.
 *
 * El `serviceClient()` (que salta RLS) queda reservado al webhook y a los
 * jobs, donde no hay usuario que autenticar.
 */
export async function dealerClient(): Promise<SupabaseClient> {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  const store = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (nuevas) => {
        try {
          for (const c of nuevas) store.set(c.name, c.value, c.options);
        } catch {
          // Los Server Components no pueden escribir cookies. El refresh de
          // sesion lo hace el middleware; aqui se ignora sin romper el render.
        }
      },
    },
  });
}
