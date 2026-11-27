"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function HideToken({ active }: { active: boolean }) {
  const pathname = usePathname();
  useEffect(() => {
    if (active) window.history.replaceState(null, "", pathname);
  }, [active, pathname]);
  return null;
}
