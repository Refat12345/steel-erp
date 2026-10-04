"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FolderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "rename";
  initialName?: string;
  initialNameEn?: string | null;
  onSubmit: (input: { name: string; nameEn: string }) => Promise<void>;
}

export function FolderFormDialog({
  open,
  onOpenChange,
  mode,
  initialName = "",
  initialNameEn = "",
  onSubmit,
}: FolderFormDialogProps) {
  const t = useTranslations("documents");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const [name, setName] = useState(initialName);
  const [nameEn, setNameEn] = useState(initialNameEn ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setNameEn(initialNameEn ?? "");
  }, [open, initialName, initialNameEn]);

  const save = async () => {
    setSaving(true);
    try {
      await onSubmit({ name, nameEn });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? t("createFolder") : t("renameFolder")}</DialogTitle>
          <DialogDescription>{t("folderNameHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="folder-name">{t("folderName")}</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="folder-name-en">{t("folderNameEn")}</Label>
            <Input
              id="folder-name-en"
              value={nameEn}
              onChange={(event) => setNameEn(event.target.value)}
              maxLength={120}
              dir="ltr"
              autoComplete="off"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={saving || name.trim().length === 0}>
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
