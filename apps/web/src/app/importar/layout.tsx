import Link from "next/link";
import type { ReactNode } from "react";

export default function ImportLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl grid-cols-[minmax(0,1fr)] content-start gap-6 px-4 pb-16 pt-[max(2rem,env(safe-area-inset-top))]">
      <Link href="/" className="self-start text-base font-semibold tracking-tight text-ink">
        Monitor de Presenças
      </Link>
      {children}
    </main>
  );
}
