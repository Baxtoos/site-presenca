"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Tira o token da barra de endereço e do histórico (a página já o recebeu). */
export function HideToken({ active }: { active: boolean }) {
  // Caminho do roteador: a barra é mascarada (lib/url-mask.ts) e window.location seria "/".
  const pathname = usePathname();
  useEffect(() => {
    if (active) window.history.replaceState(null, "", pathname);
  }, [active, pathname]);
  return null;
}
