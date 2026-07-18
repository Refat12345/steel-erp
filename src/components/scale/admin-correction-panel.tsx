"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClientIdempotencyKey } from "@/lib/browser-idempotency-key";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Pencil, Trash2, Plus, ShieldAlert } from "lucide-react";
import { getTextDirection, type Locale } from "@/i18n/config";
import { formatDecimal, formatKg } from "@/lib/number-format";
import type { SalesOrderGrade } from "@prisma/client";

interface SizeOption {
  id: number;
  code: string;
  displayName: string;
  isBundleType: boolean;
}

interface RoundLite {
  id: number;
  roundNumber: number;
  grade: SalesOrderGrade | null;
  startWeightKg: string;
  endWeightKg: string | null;
  isFinal: boolean;
  version: number;
}

interface SessionLite {
  id: number;
  bridgeRoundId: number | null;
  sessionNumber: number;
  sizeId: number | null;
  bundleCount: number | null;
  weightTons: string;
  version: number;
  size: { id: number; displayName: string } | null;
}

interface TruckLite {
  id: number;
  status: string;
  version: number;
  skipInternalWeighing: boolean;
  tareWeightKg: string | null;
  externalCardNumber: string | null;
  rounds: RoundLite[];
  sessions: SessionLite[];
}

type DialogState =
  | { kind: "tare" }
  | { kind: "card" }
  | { kind: "grade"; round: RoundLite }
  | { kind: "external"; round: RoundLite }
  | { kind: "addSession"; round: RoundLite }
  | { kind: "editSession"; session: SessionLite }
  | { kind: "deleteSession"; session: SessionLite }
  | null;

const GRADE_NONE = "__none__";

export function AdminCorrectionPanel({
  truck,
  sizes,
  onChanged,
}: {
  truck: TruckLite;
  sizes: SizeOption[];
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("scale");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [reason, setReason] = useState("");
  const [weight, setWeight] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [grade, setGrade] = useState<string>(GRADE_NONE);
  const [sizeId, setSizeId] = useState<string>(GRADE_NONE);
  const [bundleCount, setBundleCount] = useState("");
  const [tons, setTons] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (truck.status !== "Completed") return null;

  const close = () => {
    setDialog(null);
    setReason("");
    setWeight("");
    setCardNumber("");
    setGrade(GRADE_NONE);
    setSizeId(GRADE_NONE);
    setBundleCount("");
    setTons("");
  };

  const openTare = () => {
    close();
    setWeight(truck.tareWeightKg ?? "");
    setDialog({ kind: "tare" });
  };
  const openCard = () => {
    close();
    setCardNumber(truck.externalCardNumber ?? "");
    setDialog({ kind: "card" });
  };
  const openGrade = (round: RoundLite) => {
    close();
    setGrade(round.grade ?? GRADE_NONE);
    setDialog({ kind: "grade", round });
  };
  const openExternal = (round: RoundLite) => {
    close();
    setWeight(round.endWeightKg ?? "");
    setDialog({ kind: "external", round });
  };
  const openAddSession = (round: RoundLite) => {
    close();
    setDialog({ kind: "addSession", round });
  };
  const openEditSession = (session: SessionLite) => {
    close();
    setSizeId(session.sizeId ? String(session.sizeId) : GRADE_NONE);
    setBundleCount(session.bundleCount != null ? String(session.bundleCount) : "");
    setTons(session.weightTons);
    setDialog({ kind: "editSession", session });
  };
  const openDeleteSession = (session: SessionLite) => {
    close();
    setDialog({ kind: "deleteSession", session });
  };

  const submit = async (
    url: string,
    method: string,
    body: Record<string, unknown>,
  ) => {
    setSubmitting(true);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createClientIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success(t("correctionSuccess"));
      close();
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  const base = `/api/trucks/${truck.id}/admin-corrections`;
  const reasonValid = reason.trim().length > 0;

  const handleSubmit = () => {
    if (!dialog || !reasonValid) return;
    const r = reason.trim();
    switch (dialog.kind) {
      case "tare":
        return submit(`${base}/tare`, "PATCH", {
          weightKg: Number(weight),
          reason: r,
          expectedVersion: truck.version,
        });
      case "card":
        return submit(`${base}/external-card`, "PATCH", {
          externalCardNumber: cardNumber.trim(),
          reason: r,
          expectedVersion: truck.version,
        });
      case "grade":
        return submit(`${base}/grade`, "PATCH", {
          roundId: dialog.round.id,
          grade: grade === GRADE_NONE ? null : grade,
          reason: r,
          expectedVersion: dialog.round.version,
        });
      case "external":
        return submit(`${base}/external`, "PATCH", {
          roundId: dialog.round.id,
          weightKg: Number(weight),
          reason: r,
          expectedVersion: truck.version,
        });
      case "addSession":
        return submit(`${base}/sessions`, "POST", {
          roundId: dialog.round.id,
          sizeId: sizeId === GRADE_NONE ? null : Number(sizeId),
          bundleCount: bundleCount ? Number(bundleCount) : null,
          weightTons: Number(tons),
          reason: r,
        });
      case "editSession":
        return submit(`${base}/sessions/${dialog.session.id}`, "PATCH", {
          sizeId: sizeId === GRADE_NONE ? null : Number(sizeId),
          bundleCount: bundleCount ? Number(bundleCount) : null,
          weightTons: Number(tons),
          reason: r,
          expectedVersion: dialog.session.version,
        });
      case "deleteSession":
        return submit(`${base}/sessions/${dialog.session.id}`, "DELETE", {
          reason: r,
          expectedVersion: dialog.session.version,
        });
    }
  };

  const sortedRounds = [...truck.rounds].sort(
    (a, b) => a.roundNumber - b.roundNumber,
  );

  const dialogTitle =
    dialog?.kind === "tare"
      ? t("dialogCorrectTare")
      : dialog?.kind === "card"
        ? t("dialogCorrectCard")
        : dialog?.kind === "grade"
          ? t("dialogCorrectGrade")
          : dialog?.kind === "external"
            ? t("dialogCorrectExternal")
            : dialog?.kind === "addSession"
              ? t("dialogAddSession")
              : dialog?.kind === "editSession"
                ? t("dialogEditSession")
                : dialog?.kind === "deleteSession"
                  ? t("dialogDeleteSession")
                  : "";

  return (
    <Card className="border-amber-400/60 bg-amber-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-amber-900">
          <ShieldAlert className="h-4 w-4" />
          {t("adminTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="flex items-start gap-2 rounded-md bg-amber-100/70 p-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("adminWarning")}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/60 p-2">
          <div className="text-sm">
            <span className="text-muted-foreground">{t("tareWeightLabel")}</span>
            <span className="font-mono font-medium">
              {truck.tareWeightKg
                ? t("kgValue", { value: formatKg(truck.tareWeightKg) })
                : t("emDash")}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={openTare}>
            <Pencil className="h-3.5 w-3.5 me-1" />
            {t("correctTare")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/60 p-2">
          <div className="text-sm">
            <span className="text-muted-foreground">
              {t("externalCardNumber")}:{" "}
            </span>
            <span className="font-mono font-medium">
              {truck.externalCardNumber ?? t("emDash")}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={openCard}>
            <Pencil className="h-3.5 w-3.5 me-1" />
            {t("correctCardNumber")}
          </Button>
        </div>

        {sortedRounds.map((round) => {
          const roundSessions = truck.sessions.filter(
            (s) => s.bridgeRoundId === round.id,
          );
          const gradeLabel = round.grade
            ? tEnums(`grade.${round.grade}`)
            : t("gradeUnspecified");
          return (
            <div key={round.id} className="space-y-2 rounded-md border bg-background/60 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {t("roundNumber", { n: round.roundNumber })}
                  {round.isFinal && (
                    <span className="ms-1 text-xs text-muted-foreground">
                      {t("finalExit")}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("gradeColonValue", { value: gradeLabel })}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {t("startColon")}
                  <span className="font-mono tabular-nums" dir="ltr">
                    {t("kgValue", { value: formatKg(round.startWeightKg) })}
                  </span>
                </span>
                <span>
                  {t("endColon")}
                  <span className="font-mono tabular-nums" dir="ltr">
                    {round.endWeightKg
                      ? t("kgValue", { value: formatKg(round.endWeightKg) })
                      : t("emDash")}
                  </span>
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => openGrade(round)}>
                  <Pencil className="h-3.5 w-3.5 me-1" />
                  {t("correctGrade")}
                </Button>
                {round.endWeightKg != null && (
                  <Button size="sm" variant="outline" onClick={() => openExternal(round)}>
                    <Pencil className="h-3.5 w-3.5 me-1" />
                    {t("correctExternalWeight")}
                  </Button>
                )}
                {!truck.skipInternalWeighing && (
                  <Button size="sm" variant="outline" onClick={() => openAddSession(round)}>
                    <Plus className="h-3.5 w-3.5 me-1" />
                    {t("addInternalSession")}
                  </Button>
                )}
              </div>

              {!truck.skipInternalWeighing && roundSessions.length > 0 && (
                <div className="overflow-x-auto">
                  <Table className="min-w-[420px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]">#</TableHead>
                        <TableHead>{t("size")}</TableHead>
                        <TableHead>{t("bundles")}</TableHead>
                        <TableHead>{t("weightTons")}</TableHead>
                        <TableHead className="w-[90px]">{t("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roundSessions.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono">{s.sessionNumber}</TableCell>
                          <TableCell>{s.size?.displayName ?? t("emDash")}</TableCell>
                          <TableCell>{s.bundleCount ?? t("emDash")}</TableCell>
                          <TableCell className="font-mono tabular-nums text-start">
                            {formatDecimal(s.weightTons, 3)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-0.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => openEditSession(s)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                onClick={() => openDeleteSession(s)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      <Dialog open={dialog != null} onOpenChange={(o) => !o && close()}>
        <DialogContent dir={dir}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {(dialog?.kind === "tare" || dialog?.kind === "external") && (
              <div className="space-y-1.5">
                <Label>{t("weightKg")}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
                {dialog?.kind === "tare" && (
                  <p className="flex items-start gap-1 text-xs text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {t("tareRecalcWarning")}
                  </p>
                )}
              </div>
            )}

            {dialog?.kind === "card" && (
              <div className="space-y-1.5">
                <Label>{t("externalCardNumber")}</Label>
                <Input
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder={t("newCardPlaceholder")}
                  maxLength={30}
                />
              </div>
            )}

            {dialog?.kind === "grade" && (
              <div className="space-y-1.5">
                <Label>{t("grade")}</Label>
                <Select value={grade} onValueChange={(v) => setGrade(v ?? GRADE_NONE)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir={dir}>
                    <SelectItem value={GRADE_NONE}>{t("gradeUnspecified")}</SelectItem>
                    <SelectItem value="FIRST">{tEnums("grade.FIRST")}</SelectItem>
                    <SelectItem value="SECOND">{tEnums("grade.SECOND")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {(dialog?.kind === "addSession" || dialog?.kind === "editSession") && (
              <>
                <div className="space-y-1.5">
                  <Label>{t("size")}</Label>
                  <Select value={sizeId} onValueChange={(v) => setSizeId(v ?? GRADE_NONE)}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectSize")} />
                    </SelectTrigger>
                    <SelectContent dir={dir}>
                      <SelectItem value={GRADE_NONE}>{t("noSize")}</SelectItem>
                      {sizes.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("bundleCountOptional")}</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={bundleCount}
                    onChange={(e) => setBundleCount(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("weightTonsField")}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={tons}
                    onChange={(e) => setTons(e.target.value)}
                  />
                </div>
              </>
            )}

            {dialog?.kind === "deleteSession" && (
              <p className="text-sm">
                {t("deleteSessionConfirm", {
                  n: dialog.session.sessionNumber,
                  tons: formatDecimal(dialog.session.weightTons, 3),
                })}
              </p>
            )}

            <div className="space-y-1.5">
              <Label>
                {t("correctionReason")} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("correctionReasonPlaceholder")}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                submitting ||
                !reasonValid ||
                (dialog?.kind === "card" && cardNumber.trim().length === 0)
              }
              variant={dialog?.kind === "deleteSession" ? "destructive" : "default"}
            >
              {dialog?.kind === "deleteSession" ? t("delete") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
