import Link from "next/link";
import { BellIcon } from "@/components/icons";

/** Sino do cabeçalho: leva à central e mostra quantos avisos não foram lidos. */
export function NotificationBell({ unread }: { unread: number }) {
  const label =
    unread === 0 ? "Avisos" : `Avisos, ${unread} não ${unread === 1 ? "lido" : "lidos"}`;
  return (
    <Link
      href="/avisos"
      aria-label={label}
      title={label}
      className="relative grid size-10 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      data-testid="sino"
    >
      <BellIcon size={20} />
      {unread > 0 ? (
        <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-fail px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-paper">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
