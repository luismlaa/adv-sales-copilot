import { iniciarSesion } from "./actions";

export const metadata = { title: "Entrar · Sales Copilot" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="login">
      <h1>Sales Copilot</h1>
      <p className="subtitulo">Entra con la cuenta de tu concesionario.</p>

      <form action={iniciarSesion} className="login-form">
        <label>
          Correo
          <input type="email" name="email" autoComplete="username" required />
        </label>
        <label>
          Clave
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        {error !== undefined && (
          <p role="alert" className="login-error">
            Correo o clave incorrectos.
          </p>
        )}
        <button type="submit">Entrar</button>
      </form>
    </main>
  );
}
