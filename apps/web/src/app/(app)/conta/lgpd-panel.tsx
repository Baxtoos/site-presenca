"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { Alert, Button, Field } from "@/components/ui";
import { ApiError, api } from "@/lib/api-client";
import { deleteAccount } from "./delete-account";

const IRREVERSIBLE =
  "Esta ação não tem volta: todos os seus semestres, matérias, registros de presença, trilha de auditoria e códigos compartilhados serão apagados.";

export function LgpdPanel({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const router = useRouter();
  const offline = useOffline();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [linkSent, setLinkSent] = useState(false);

  return (
    <section className="grid gap-4 card p-5 sm:p-6 text-sm" aria-labelledby="lgpd-heading">
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
                setLinkSent(false);
                setConfirmOpen(true);
              }}
            >
              Excluir minha conta
            </Button>
          </div>
        ) : hasPassword ? (
          <form
            className="grid gap-3 rounded-xl border border-fail/30 bg-fail-soft/40 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setPending(true);
              setError(undefined);
              void deleteAccount({ password: value }, offline.userId)
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
            <p className="font-semibold text-fail">{IRREVERSIBLE}</p>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Field
              id="delete-account-confirm"
              label="Confirme sua senha atual para excluir a conta"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Sua senha"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
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
        ) : (
          <div className="grid gap-3 rounded-xl border border-fail/30 bg-fail-soft/40 p-4">
            <p className="font-semibold text-fail">{IRREVERSIBLE}</p>
            {error ? <Alert tone="error">{error}</Alert> : null}
            {linkSent ? (
              <Alert tone="success">
                Enviamos um link para <span className="[overflow-wrap:anywhere]">{email}</span>.
                Abra-o neste aparelho em até 15 minutos para confirmar a exclusão.
              </Alert>
            ) : (
              <p>
                Como você entra sem senha, a confirmação é por e-mail: vamos enviar um link para{" "}
                <strong className="[overflow-wrap:anywhere]">{email}</strong>.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="danger"
                loading={pending}
                onClick={() => {
                  setPending(true);
                  setError(undefined);
                  api("/v1/me/delete-request", { method: "POST" })
                    .then(() => setLinkSent(true))
                    .catch((err: unknown) =>
                      setError(
                        err instanceof ApiError
                          ? err.message
                          : "Não foi possível enviar o link. Tente novamente.",
                      ),
                    )
                    .finally(() => setPending(false));
                }}
              >
                {linkSent ? "Enviar outro link" : "Enviar link de exclusão"}
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
          </div>
        )}
      </div>
    </section>
  );
}
