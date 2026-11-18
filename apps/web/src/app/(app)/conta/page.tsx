import { notificationPreferencesSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { NotificationSettings } from "@/components/notifications/settings";
import { apiGet, getMe } from "@/lib/api-server";
import { LogoutButton, SessionsPanel } from "../home-client";
import { LgpdPanel } from "./lgpd-panel";

export const metadata: Metadata = { title: "Conta · Monitor de Presenças" };

export default async function AccountPage() {
  const [me, prefs] = await Promise.all([
    getMe(),
    apiGet("/v1/notification-preferences", notificationPreferencesSchema),
  ]);
  return (
    <>
      <header className="grid gap-0.5">
        <h1 className="text-2xl font-bold tracking-tight">Conta</h1>
        <p className="text-sm text-muted [overflow-wrap:anywhere]">
          {me?.fullName} · {me?.email}
        </p>
      </header>
      <NotificationSettings initial={prefs} />
      <SessionsPanel />
      {me ? <LgpdPanel email={me.email} hasPassword={me.hasPassword} /> : null}
      <section
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-6 text-sm"
        aria-label="Sair"
      >
        <p className="text-muted">Sair desta conta neste aparelho.</p>
        <LogoutButton />
      </section>
    </>
  );
}
