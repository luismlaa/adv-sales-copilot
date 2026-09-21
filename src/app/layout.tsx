import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Sales Copilot",
  description: "Califica leads de WhatsApp y arma el expediente de financiamiento.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-DO">
      <body>{children}</body>
    </html>
  );
}
