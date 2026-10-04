import Link from "next/link";
import { Folder } from "lucide-react";

export function FolderLinkCard({
  href,
  name,
  detail,
}: {
  href: string;
  name: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-foreground/15 hover:bg-muted/40"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
        <Folder className="size-6 fill-amber-400 text-amber-500" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </Link>
  );
}
