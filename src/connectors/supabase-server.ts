import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/config/env";

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

/**
 * Cliente del flujo de autenticacion (login y logout).
 *
 * Identico a `dealerClient()` en todo menos en una cosa: aqui el fallo al
 * escribir la cookie **si** revienta. Un Server Action tiene permiso para
 * escribirla, asi que un fallo en este camino es un fallo real, no el caso
 * esperado de los Server Components. Tragarselo dejaria a
 * `signInWithPassword()` devolviendo exito con la sesion sin aterrizar: el
 * middleware rebota a /login, el usuario ve el formulario otra vez y el login
 * parece no hacer nada.
 */
export async function authClient(): Promise<SupabaseClient> {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  const store = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (nuevas) => {
        for (const c of nuevas) store.set(c.name, c.value, c.options);
      },
    },
  });
}
