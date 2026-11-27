import type { DeleteMeBody } from "@presenca/contracts";
import { api } from "@/lib/api-client";
import { clearOfflineData } from "@/lib/offline-cache";
import { disablePushOnThisDevice } from "@/lib/push-client";

export async function deleteAccount(body: DeleteMeBody, userId: string): Promise<void> {
  await disablePushOnThisDevice().catch(() => undefined);
  await api("/v1/me", { method: "DELETE", body });
  await clearOfflineData(userId).catch(() => undefined);
}
