import { notificationPreferencesSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { NotificationSettings } from "@/components/notifications/settings";
import { apiGet, getMe } from "@/lib/api-server";
import { LogoutButton, SessionsPanel } from "../home-client";
import { LgpdPanel } from "./lgpd-panel";
import { PageHeader } from "@/components/ui";
import { UserIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Conta · Monitor de Presenças" };

export default async function AccountPage() {
  const [me, prefs] = await Promise.all([
    getMe(),
    apiGet("/v1/notification-preferences", notificationPreferencesSchema),
  ]);
  return (
    <>
      <PageHeader
        icon={<UserIcon size={26} />}
        title="Conta"
        description={
          <span className="[overflow-wrap:anywhere]">
            {me?.fullName} · {me?.email}
          </span>
        }
      />
      <NotificationSettings initial={prefs} />
      <SessionsPanel />
      {me ? <LgpdPanel email={me.email} hasPassword={me.hasPassword} /> : null}
      <section
        className="flex flex-wrap items-center justify-between gap-3 card p-5 sm:p-6 text-sm"
        aria-label="Sair"
      >
        <p className="text-muted">Sair desta conta neste aparelho.</p>
        <LogoutButton />
      </section>
    </>
  );
}
