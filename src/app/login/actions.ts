"use server";

import { redirect } from "next/navigation";
import { authClient } from "@/connectors/supabase-server";

/**
 * Devuelve `true` solo si la sesion quedo escrita en las cookies.
 *
 * El `catch` cubre el fallo al escribirlas, que `authClient()` deja reventar a
 * proposito: sin el, un login sin sesion redirigiria al tablero y el
 * middleware lo devolveria al formulario sin explicar nada.
 */
async function sesionIniciada(email: string, password: string): Promise<boolean> {
  try {
    const db = await authClient();
    const { error } = await db.auth.signInWithPassword({ email, password });
    return error === null;
  } catch {
    return false;
  }
}

/** Inicia sesion con correo y clave. El error nunca dice cual de los dos fallo. */
export async function iniciarSesion(form: FormData): Promise<never> {
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string" || email === "" || password === "") {
    redirect("/login?error=1");
  }

  // `redirect()` lanza para cortar el flujo, asi que va fuera del try de
  // `sesionIniciada`: dentro, el catch se lo comeria.
  if (!(await sesionIniciada(email, password))) redirect("/login?error=1");

  redirect("/kanban");
}

export async function cerrarSesion(): Promise<never> {
  // Tambien con `authClient()`: si el borrado de la cookie se tragara en
  // silencio, el usuario quedaria con sesion viva despues de "Salir".
  const db = await authClient();
  await db.auth.signOut();
  redirect("/login");
}
