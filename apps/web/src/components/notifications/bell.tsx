import Link from "next/link";

/** Sino do cabeçalho: leva à central e mostra quantos avisos não foram lidos. */
export function NotificationBell({ unread }: { unread: number }) {
  const label =
    unread === 0 ? "Avisos" : `Avisos, ${unread} não ${unread === 1 ? "lido" : "lidos"}`;
  return (
    <Link
      href="/avisos"
      aria-label={label}
      title={label}
      className="relative grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
      data-testid="sino"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path
          d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {unread > 0 ? (
        <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-fail px-1 text-[10px] font-bold leading-4 text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
