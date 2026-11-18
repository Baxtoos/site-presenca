import type { Metadata } from "next";
import { getMe } from "@/lib/api-server";
import { SessionsPanel } from "../home-client";

export const metadata: Metadata = { title: "Conta · Monitor de Presenças" };

export default async function AccountPage() {
  const me = await getMe();
  return (
    <>
      <header className="grid gap-0.5">
        <h1 className="text-2xl font-bold tracking-tight">Conta</h1>
        <p className="text-sm text-muted">
          {me?.fullName} · {me?.email}
        </p>
      </header>
      <SessionsPanel />
    </>
  );
}
