import type { Metadata } from "next";
import { AlertIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { getMe } from "@/lib/api-server";
import { ConfirmDeletion } from "./confirm-deletion";

export const metadata: Metadata = {
  title: "Excluir conta · Monitor de Presenças",
  referrer: "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && TOKEN.test(raw) ? raw : undefined;
  const me = await getMe();
  return (
    <>
      <PageHeader
        icon={<AlertIcon size={26} />}
        title="Excluir conta"
        back={{ href: "/conta", label: "Conta" }}
      />
      <ConfirmDeletion token={token} email={me?.email ?? ""} />
    </>
  );
}
