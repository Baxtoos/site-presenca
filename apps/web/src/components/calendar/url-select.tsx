"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { INPUT_CLASS } from "@/components/ui";

export function UrlSelect({
  id,
  label,
  param,
  options,
}: {
  id: string;
  label: string;
  param: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor={id}>
      {label}
      <select
        id={id}
        value={params.get(param) ?? ""}
        className={INPUT_CLASS}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set(param, e.target.value);
          else next.delete(param);
          const query = next.toString();
          router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
