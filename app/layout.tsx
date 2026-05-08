import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Escala Danilo — Azul",
  description: "Dashboard privado para visualizar a escala de voo do Danilo de forma clara."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
