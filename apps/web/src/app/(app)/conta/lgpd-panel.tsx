"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { Alert, Button, Field } from "@/components/ui";
import { ApiError, api } from "@/lib/api-client";
import { clearOfflineData } from "@/lib/offline-cache";
import { disablePushOnThisDevice } from "@/lib/push-client";

export function LgpdPanel({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const router = useRouter();
  const offline = useOffline();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <section
      className="grid gap-4 rounded-2xl border border-line bg-surface p-6 text-sm"
      aria-labelledby="lgpd-heading"
    >
      <div className="grid gap-1">
        <h2 id="lgpd-heading" className="text-base font-semibold text-ink">
          Seus dados e privacidade (LGPD)
        </h2>
        <p className="text-muted">
          Você pode baixar uma cópia completa de todos os seus dados em JSON ou excluir
          definitivamente sua conta quando quiser.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/api/v1/me/export.json"
          download="meus-dados-presenca.json"
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:border-accent/50"
        >
          Baixar meus dados (JSON)
        </a>
        <Link href="/privacidade" className="text-sm font-medium text-accent hover:underline">
          Política de Privacidade
        </Link>
        <Link href="/termos" className="text-sm font-medium text-accent hover:underline">
          Termos de Uso
        </Link>
      </div>

      <div className="border-t border-line pt-4">
        {!confirmOpen ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted">
              Apagar permanentemente sua conta, matérias, faltas e histórico.
            </p>
            <Button
              variant="danger"
              onClick={() => {
                setError(undefined);
                setValue("");
                setConfirmOpen(true);
              }}
            >
              Excluir minha conta
            </Button>
          </div>
        ) : (
          <form
            className="grid gap-3 rounded-xl border border-fail/30 bg-fail-soft/40 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setPending(true);
              setError(undefined);
              void disablePushOnThisDevice()
                .catch(() => undefined)
                .then(() =>
                  api("/v1/me", {
                    method: "DELETE",
                    body: hasPassword ? { password: value } : { email: value.trim().toLowerCase() },
                  }),
                )
                .then(() => clearOfflineData(offline.userId).catch(() => undefined))
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
            <p className="font-semibold text-fail">
              Esta ação não tem volta: todos os seus semestres, matérias, registros de presença,
              trilha de auditoria e códigos compartilhados serão apagados agora.
            </p>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Field
              id="delete-account-confirm"
              label={
                hasPassword
                  ? "Confirme sua senha atual para excluir a conta"
                  : `Digite seu e-mail (${email}) para confirmar a exclusão`
              }
            >
              <input
                id="delete-account-confirm"
                type={hasPassword ? "password" : "email"}
                required
                autoComplete={hasPassword ? "current-password" : "email"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm"
                placeholder={hasPassword ? "Sua senha" : email}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="danger" loading={pending}>
                Confirmar exclusão definitiva
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setConfirmOpen(false)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
