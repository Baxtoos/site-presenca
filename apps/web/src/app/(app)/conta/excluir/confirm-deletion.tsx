"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { Alert, Button, ButtonLink } from "@/components/ui";
import { ApiError } from "@/lib/api-client";
import { deleteAccount } from "../delete-account";

export function ConfirmDeletion({ token, email }: { token?: string; email: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const offline = useOffline();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (token) window.history.replaceState(null, "", pathname);
  }, [pathname, token]);

  if (!token) {
    return (
      <div className="grid gap-4">
        <Alert tone="error">Este link de exclusão está incompleto ou inválido.</Alert>
        <p className="text-sm text-muted">
          Peça um novo na página Conta, em &quot;Seus dados e privacidade&quot;.
        </p>
        <div>
          <ButtonLink href="/conta" variant="secondary">
            Voltar para Conta
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <section
      className="grid gap-4 card border-fail/30 p-5 text-sm sm:p-6"
      aria-labelledby="excluir-titulo"
    >
      <h2 id="excluir-titulo" className="text-base font-semibold text-fail">
        Excluir definitivamente a conta{" "}
        {email ? <span className="[overflow-wrap:anywhere]">{email}</span> : null}
      </h2>
      <p>
        Todos os seus semestres, matérias, registros de presença, trilha de auditoria e códigos
        compartilhados serão apagados agora. Esta ação não tem volta.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="danger"
          loading={pending}
          onClick={() => {
            setPending(true);
            setError(undefined);
            deleteAccount({ token }, offline.userId)
              .then(() => {
                router.replace("/entrar");
                router.refresh();
              })
              .catch((err: unknown) => {
                setError(
                  err instanceof ApiError
                    ? err.message
                    : "Não foi possível excluir a conta. Tente novamente.",
                );
                setPending(false);
              });
          }}
        >
          Excluir minha conta
        </Button>
        <ButtonLink href="/conta" variant="secondary">
          Cancelar
        </ButtonLink>
      </div>
    </section>
  );
}
