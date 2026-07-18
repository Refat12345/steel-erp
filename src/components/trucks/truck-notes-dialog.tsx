"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClientIdempotencyKey } from "@/lib/browser-idempotency-key";
import { notesForPatch, NOTES_ONLY_EDITABLE_STATUSES } from "@/lib/truck-edit-ui";
import { getTextDirection, type Locale } from "@/i18n/config";

interface Props {
  truckId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface NotesTruck {
  id: number;
  status: string;
  version: number;
  notes: string | null;
}

export function TruckNotesDialog({ truckId, open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations("trucks");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  const [truck, setTruck] = useState<NotesTruck | null>(null);
  const [notes, setNotes] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || truckId == null) {
      setTruck(null);
      setNotes("");
      return;
    }

    let cancelled = false;

    const loadTruck = async () => {
      setLoadingDetail(true);
      setTruck(null);
      try {
        const res = await fetch(`/api/trucks/${truckId}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || t("errorLoadTruck"));

        const data = json.data as NotesTruck;
        if (
          !(NOTES_ONLY_EDITABLE_STATUSES as readonly string[]).includes(data.status)
        ) {
          toast.error(t("errorNotesNotEditable"));
          onOpenChange(false);
          return;
        }

        setTruck({
          id: data.id,
          status: data.status,
          version: data.version,
          notes: data.notes,
        });
        setNotes(data.notes ?? "");
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : t("errorLoadTruckGeneric"));
          onOpenChange(false);
        }
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    };

    void loadTruck();
    return () => {
      cancelled = true;
    };
    // onOpenChange omitted — parent inline callback would retrigger fetch every render
  }, [open, truckId, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!truck) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/trucks/${truck.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createClientIdempotencyKey(),
        },
        body: JSON.stringify({
          expectedVersion: truck.version,
          notes: notesForPatch(notes),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success(t("notesSuccess"));
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errorNotes"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="max-w-md min-w-0 overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{t("notesTitle", { id: truckId ?? truck?.id ?? "" })}</DialogTitle>
        </DialogHeader>
        {loadingDetail ? (
          <div className="space-y-4 py-2">
            <div className="h-24 animate-pulse rounded-md bg-muted" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {t("notesOnlyHint")}
            </p>
            <div className="space-y-2">
              <Label htmlFor="truckNotes">{t("notesLabel")}</Label>
              <Textarea
                id="truckNotes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={2000}
                disabled={saving}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={!truck || saving}>
                {saving ? t("saving") : t("saveNotes")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
