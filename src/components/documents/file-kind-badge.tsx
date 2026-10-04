import { File, FileImage, FileSpreadsheet, FileText, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type FileKind = "pdf" | "excel" | "word" | "image" | "other";

const KIND_STYLE: Record<FileKind, { icon: LucideIcon; className: string }> = {
  pdf: { icon: FileText, className: "bg-red-500/10 text-red-600 dark:text-red-400" },
  excel: { icon: FileSpreadsheet, className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  word: { icon: FileText, className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  image: { icon: FileImage, className: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  other: { icon: File, className: "bg-muted text-muted-foreground" },
};

function fileKind(mimeType: string, fileName: string): FileKind {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (extension === "xls" || extension === "xlsx") return "excel";
  if (extension === "doc" || extension === "docx") return "word";
  return "other";
}

export function FileKindBadge({
  mimeType,
  fileName,
  className,
}: {
  mimeType: string;
  fileName: string;
  className?: string;
}) {
  const { icon: Icon, className: kindClassName } = KIND_STYLE[fileKind(mimeType, fileName)];
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md",
        kindClassName,
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
