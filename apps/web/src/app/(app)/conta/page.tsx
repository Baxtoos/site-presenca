import { mfaStatusResponseSchema, notificationPreferencesSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { FeedbackForm } from "@/components/feedback-form";
import { MfaPanel } from "@/components/mfa-panel";
import { NotificationSettings } from "@/components/notifications/settings";
import { ThemePicker } from "@/components/theme-picker";
import { apiGet, getMe } from "@/lib/api-server";
import { LogoutButton, SessionsPanel } from "../home-client";
import { LgpdPanel } from "./lgpd-panel";
import { PageHeader } from "@/components/ui";
import { UserIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Conta · Monitor de Presenças" };

export default async function AccountPage() {
  const [me, prefs, mfa] = await Promise.all([
    getMe(),
    apiGet("/v1/notification-preferences", notificationPreferencesSchema),
    apiGet("/v1/me/mfa", mfaStatusResponseSchema),
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
      <ThemePicker />
      {me ? <MfaPanel initial={mfa} hasPassword={me.hasPassword} email={me.email} /> : null}
      <SessionsPanel />
      <FeedbackForm />
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
