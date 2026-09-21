"use server";

import { redirect } from "next/navigation";
import { dealerClient } from "@/connectors/supabase-server";

/** Inicia sesion con correo y clave. El error nunca dice cual de los dos fallo. */
export async function iniciarSesion(form: FormData): Promise<never> {
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string" || email === "" || password === "") {
    redirect("/login?error=1");
  }

  const db = await dealerClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error !== null) redirect("/login?error=1");

  redirect("/kanban");
}

export async function cerrarSesion(): Promise<never> {
  const db = await dealerClient();
  await db.auth.signOut();
  redirect("/login");
}
