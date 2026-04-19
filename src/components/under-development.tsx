import { Construction } from "lucide-react";

type Props = {
  title: string;
  description?: string;
};

export function UnderDevelopment({
  title,
  description = "هذا القسم قيد التطوير وسيتم تفعيله لاحقاً.",
}: Props) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 px-4 py-12 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted/40 shadow-sm"
        aria-hidden
      >
        <Construction className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
