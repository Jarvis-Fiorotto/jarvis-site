import { currentUser } from "../../lib/auth";
import { redirect } from "next/navigation";

type LoginProps = {
  searchParams?: Promise<{ error?: string; username?: string }>;
};

export default async function LoginPage({ searchParams }: LoginProps) {
  const user = await currentUser();
  if (user) redirect("/");
  const params = (await searchParams) || {};
  const hasError = params.error === "1";

  return (
    <main className="loginShell">
      <section className="loginCard">
        <div className="brandMark">J</div>
        <p className="eyebrow">Escala Azul</p>
        <h1>Entrar na escala do Danilo</h1>
        <p className="loginText">Acesso reservado para usuários autorizados.</p>
        {hasError && <div className="loginError">Usuário ou senha inválidos.</div>}
        <form action="/api/login" method="post" className="loginForm">
          <label>
            Usuário
            <input name="username" type="text" autoComplete="username" defaultValue={params.username || ""} required />
          </label>
          <label>
            Senha
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Acessar escala</button>
        </form>
      </section>
    </main>
  );
}
