import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JARVIS — Copiloto Cognitivo Executivo",
  description:
    "JARVIS é o agente executivo central do Danilo Fiorotto: clareza operacional, automação segura e execução assistida por IA.",
  openGraph: {
    title: "JARVIS — Copiloto Cognitivo Executivo",
    description:
      "Sistema auxiliar de clareza, automação e execução para projetos, decisões e operações.",
    type: "website"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
