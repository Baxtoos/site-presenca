import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Precisa rodar antes do Next hidratar (ver lib/url-mask.ts). */}
        <script dangerouslySetInnerHTML={{ __html: URL_MASK_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
