import { notificationListSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { Inbox } from "@/components/notifications/inbox";
import { apiGet } from "@/lib/api-server";
import { ButtonLink, PageHeader } from "@/components/ui";
import { BellIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Avisos · Monitor de Presenças" };

export default async function NotificationsPage() {
  const list = await apiGet("/v1/notifications?limit=20", notificationListSchema);
  return (
    <>
      <PageHeader
        icon={<BellIcon size={26} />}
        title="Avisos"
        description="Alertas de falta e lembretes. Os mais novos ficam em cima."
        actions={
          <ButtonLink href="/conta#notificacoes" variant="secondary">
            Configurar avisos
          </ButtonLink>
        }
      />
      <Inbox initial={list} />
    </>
  );
}
