import { mfaStatusResponseSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { UserIcon } from "@/components/icons";
import { MfaPanel } from "@/components/mfa-panel";
import { Alert, ButtonLink, PageHeader } from "@/components/ui";
import { apiGet, getMe } from "@/lib/api-server";
import { HideToken } from "./hide-token";

export const metadata: Metadata = {
  title: "Verificação em duas etapas · Monitor de Presenças",
  // A URL contém o token: nada de enviá-la como Referer para outros sites.
  referrer: "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Destino do link "ligar a verificação em duas etapas" (contas sem senha). Não consome o link ao
 * abrir: o token só é usado no clique em Continuar.
 */
export default async function MfaConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && TOKEN.test(raw) ? raw : undefined;
  const [me, mfa] = await Promise.all([getMe(), apiGet("/v1/me/mfa", mfaStatusResponseSchema)]);
  return (
    <>
      <PageHeader
        icon={<UserIcon size={26} />}
        title="Verificação em duas etapas"
        back={{ href: "/conta", label: "Conta" }}
      />
      <HideToken active={Boolean(token)} />
      {token && me ? (
        <MfaPanel
          initial={mfa}
          hasPassword={me.hasPassword}
          email={me.email}
          confirmToken={token}
        />
      ) : (
        <div className="grid gap-4">
          <Alert tone="error">Este link está incompleto ou inválido.</Alert>
          <div>
            <ButtonLink href="/conta" variant="secondary">
              Voltar para Conta
            </ButtonLink>
          </div>
        </div>
      )}
    </>
  );
}
