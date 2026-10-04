"use client";

import { useEffect } from "react";
import { FileDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { getTextDirection, type Locale } from "@/i18n/config";
import { documentDisplaysInline } from "@/lib/documents/file-signature";
import { Button } from "@/components/ui/button";
import { PdfCanvasViewer } from "@/components/documents/pdf-canvas-viewer";

export interface PreviewFile {
  id: number;
  fileName: string;
  mimeType: string;
}

export function DocumentPreviewDialog({
  file,
  onClose,
}: {
  file: PreviewFile | null;
  onClose: () => void;
}) {
  const t = useTranslations("documents");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  useEffect(() => {
    if (!file) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, onClose]);

  if (!file) return null;

  const src = `/api/documents/files/${file.id}`;
  const viewable = documentDisplaysInline(file.mimeType);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" dir={dir}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-medium">{file.fileName}</h2>
        <Button
          nativeButton={false}
          render={<a href={`${src}?mode=download`} download={file.fileName} />}
        >
          {t("downloadFile")}
        </Button>
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>

      {!viewable && (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <FileDown className="size-7" />
            </span>
            <div className="space-y-1">
              <p className="text-base font-medium">{t("cannotPreviewTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("cannotPreview")}</p>
            </div>
          </div>
        </div>
      )}

      {viewable && file.mimeType === "application/pdf" && (
        <PdfCanvasViewer
          src={`${src}?mode=preview`}
          loadingLabel={t("previewLoading")}
          errorLabel={t("previewFailed")}
        />
      )}
      {viewable && file.mimeType.startsWith("image/") && (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
          <img src={src} alt={file.fileName} className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}
