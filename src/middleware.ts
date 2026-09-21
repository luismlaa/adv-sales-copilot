import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/config/env";

/**
 * Sesion del dealer.
 *
 * Refresca el JWT en cada request y deja pasar solo a usuarios autenticados.
 * Los Server Components no pueden escribir cookies, asi que el refresh tiene
 * que ocurrir aqui: sin esto la sesion caduca en silencio y RLS devuelve un
 * tablero vacio en vez de un error.
 *
 * `/api/*` queda fuera: el webhook se autentica por firma HMAC de Meta y la
 * importacion valida la sesion por su cuenta.
 */

const PUBLICAS = ["/login"];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (nuevas) => {
        for (const c of nuevas) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of nuevas) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });

  // getUser() valida el JWT contra Supabase; getSession() solo lo decodifica
  // y no sirve como control de acceso.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ruta = request.nextUrl.pathname;
  const esPublica = PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));

  if (user === null && !esPublica) return redirigir(request, response, "/login");
  if (user !== null && esPublica) return redirigir(request, response, "/kanban");
  return response;
}

/** Redirige conservando las cookies de sesion que el refresh acaba de escribir. */
function redirigir(request: NextRequest, origen: NextResponse, destino: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = destino;
  url.search = "";
  const redireccion = NextResponse.redirect(url);
  for (const c of origen.cookies.getAll()) redireccion.cookies.set(c);
  return redireccion;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
