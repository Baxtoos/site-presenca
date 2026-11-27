import { mfaStatusResponseSchema, notificationPreferencesSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { FeedbackForm } from "@/components/feedback-form";
import { MfaPanel } from "@/components/mfa-panel";
import { MoodleCard } from "@/components/moodle/moodle-card";
import { ProfileForm } from "@/components/profile-form";
import { NotificationSettings } from "@/components/notifications/settings";
import { ThemePicker } from "@/components/theme-picker";
import { apiGet, getMe } from "@/lib/api-server";
import { LogoutButton, SessionsPanel } from "../home-client";
import { LgpdPanel } from "./lgpd-panel";
import { ButtonLink, PageHeader, SectionTitle } from "@/components/ui";
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
      {me ? <ProfileForm initial={me} /> : null}
      <NotificationSettings initial={prefs} />
      <section className="card grid gap-3 p-5 text-sm sm:p-6" aria-labelledby="suap-conta">
        <SectionTitle
          id="suap-conta"
          action={
            <ButtonLink href="/semestres/suap" variant="secondary">
              Conectar
            </ButtonLink>
          }
        >
          SUAP
        </SectionTitle>
        <p className="text-muted">
          Traga do SUAP as disciplinas, o horário, as faltas e as notas do boletim com o favorito do
          navegador.
        </p>
      </section>
      <MoodleCard />
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
