import type { MetadataRoute } from "next";

/** Manifest do app instalável (tela inicial do celular e janela própria no computador). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Monitor de Presenças",
    short_name: "Presenças",
    description: "Controle suas faltas por matéria e saiba quanto ainda pode faltar.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f6f8",
    theme_color: "#1d5c8c",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Aulas de hoje",
        short_name: "Hoje",
        url: "/hoje",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
