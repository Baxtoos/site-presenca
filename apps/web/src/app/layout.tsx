import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { THEME_COLOR, THEME_SCRIPT } from "@/lib/theme";
import { URL_MASK_SCRIPT } from "@/lib/url-mask";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monitor de Presenças",
  description: "Controle suas faltas por matéria e saiba quanto ainda pode faltar.",
  applicationName: "Monitor de Presenças",
  // iOS: abre em tela cheia quando instalado pela "Adicionar à Tela de Início".
  appleWebApp: { capable: true, title: "Presenças", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce desta resposta (src/proxy.ts): sem ele a CSP bloqueia os scripts inline abaixo.
  // Ler o cabeçalho deixa todas as páginas dinâmicas, o que o nonce exige.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // data-theme é posto pelo script de tema antes da hidratação (ver lib/theme.ts).
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Precisa rodar antes do Next hidratar (ver lib/url-mask.ts). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: URL_MASK_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
