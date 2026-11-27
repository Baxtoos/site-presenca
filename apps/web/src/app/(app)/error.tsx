"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="grid gap-3 card p-5 sm:p-6" role="alert">
      <h1 className="text-lg font-semibold">Não foi possível carregar esta página</h1>
      <p className="text-sm text-muted">
        O servidor não respondeu como esperado. Seus dados estão salvos; tente de novo em instantes.
      </p>
      <Button
        className="w-fit"
        loading={retrying}
        onClick={() => {
          setRetrying(true);
          retry();
        }}
      >
        Tentar de novo
      </Button>
    </section>
  );
}
