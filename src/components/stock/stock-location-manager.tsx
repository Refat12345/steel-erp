"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Warehouse, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTextDirection, type Locale } from "@/i18n/config";
import { StockLocationFormDialog } from "./stock-location-form-dialog";
import {
  SEGMENT_META,
  SEGMENT_ORDER,
  type Segment,
  type Yard,
  type StockLocation,
  type SizeOption,
  type LocationClassificationRef,
} from "./stock-shared";

interface ApiLocation extends Omit<StockLocation, "movementCount"> {
  _count: { movements: number };
}
interface ApiYard extends Omit<Yard, "locations"> {
  locations: ApiLocation[];
}

function normalizeYard(y: ApiYard): Yard {
  return {
    ...y,
    locations: y.locations.map((l) => ({
      ...l,
      movementCount: l._count?.movements ?? 0,
    })),
  };
}

function segmentUnitKey(segment: Segment): "segmentUnitByTons" | "segmentUnitByBundles" {
  return segment === "SHORTBAR" ? "segmentUnitByTons" : "segmentUnitByBundles";
}

/** Schematic grid preview of one yard, driven by gridRow/gridCol/gridSpan. */
function YardMap({ yard }: { yard: Yard }) {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  const active = yard.locations.filter((l) => l.isActive);
  if (active.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {t("noActiveLocationsInYard")}
      </div>
    );
  }
  const maxCol = Math.max(...active.map((l) => l.gridCol + l.gridSpan - 1), 1);
  const maxRow = Math.max(...active.map((l) => l.gridRow), 1);

  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/30 p-3">
      <div
        dir="ltr"
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${maxCol}, minmax(88px, 1fr))`,
          gridTemplateRows: `repeat(${maxRow}, auto)`,
          minWidth: maxCol * 96,
        }}
      >
        {active.map((l) => {
          const meta = SEGMENT_META[l.segment];
          const segmentLabel = tEnums(`stockSegment.${l.segment}`);
          return (
            <div
              key={l.id}
              className={cn(
                "flex flex-col justify-between rounded-md border p-2 text-center shadow-sm",
                meta.tile,
              )}
              style={{
                gridColumn: `${l.gridCol} / span ${l.gridSpan}`,
                gridRow: `${l.gridRow}`,
              }}
              title={`${l.nameAr} (${l.code}) — ${segmentLabel}`}
            >
              <div
                className="line-clamp-2 text-sm font-bold leading-snug"
                dir={dir}
              >
                {l.nameAr}
              </div>
              <div className="truncate text-[10px] font-medium opacity-80" dir={dir}>
                {segmentLabel}
              </div>
              <div className="font-mono text-[10px] tabular-nums opacity-60">
                {l.code}
              </div>
              <div className="text-[10px] font-medium opacity-70">
                {l.expectedSize
                  ? l.expectedSize.displayName
                  : t(segmentUnitKey(l.segment))}
                {l.expectedClassification
                  ? ` · ${l.expectedClassification.code}`
                  : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SegmentLegend() {
  const tEnums = useTranslations("enums");
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {SEGMENT_ORDER.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", SEGMENT_META[s].dot)} />
          {tEnums(`stockSegment.${s}`)}
        </div>
      ))}
    </div>
  );
}

export function StockLocationManager() {
  const t = useTranslations("stock");
  const tEnums = useTranslations("enums");

  const [yards, setYards] = useState<Yard[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [classifications, setClassifications] = useState<LocationClassificationRef[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeYard, setActiveYard] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editLocation, setEditLocation] = useState<StockLocation | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stock/locations");
      const json = await res.json();
      if (json.success) {
        const normalized = (json.data.yards as ApiYard[]).map(normalizeYard);
        setYards(normalized);
        setSizes(json.data.sizes as SizeOption[]);
        setClassifications(
          (json.data.classifications as LocationClassificationRef[]) ?? [],
        );
        setCanManage(!!json.data.canManage);
        setActiveYard((prev) =>
          prev && normalized.some((y) => String(y.id) === prev)
            ? prev
            : normalized[0]
              ? String(normalized[0].id)
              : "",
        );
      } else {
        toast.error(json.error || t("errorLoadLocations"));
      }
    } catch {
      toast.error(t("errorConnection"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function handleAdd() {
    setEditLocation(null);
    setDialogOpen(true);
  }
  function handleEdit(loc: StockLocation) {
    setEditLocation(loc);
    setDialogOpen(true);
  }

  async function handleDelete(loc: StockLocation) {
    const warnDeactivate = loc.movementCount > 0;
    const message = warnDeactivate
      ? t("confirmDeactivate", { name: loc.nameAr })
      : t("confirmDelete", { name: loc.nameAr });
    if (!window.confirm(message)) return;
    try {
      const res = await fetch(`/api/stock/locations/${loc.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t("errorDelete"));
        return;
      }
      toast.success(
        json.data?.deactivated ? t("locationDeactivated") : t("locationDeleted"),
      );
      void fetchData();
    } catch {
      toast.error(t("errorConnection"));
    }
  }

  function segmentGradeLabel(segment: Segment): string {
    if (segment === "SHORTBAR") return t("noGrade");
    if (segment === "ISOLATION") return tEnums("grade.SECOND");
    return tEnums("grade.FIRST");
  }

  const yardOptions = yards.map((y) => ({ id: y.id, code: y.code, nameAr: y.nameAr }));

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentLegend />
        {canManage && (
          <Button size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            {t("addLocation")}
          </Button>
        )}
      </div>

      {yards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <Warehouse className="mx-auto mb-2 h-8 w-8 opacity-40" />
          {t("noYardsConfigured")}
        </div>
      ) : (
        <Tabs value={activeYard} onValueChange={(v) => setActiveYard(v as string)}>
          <TabsList>
            {yards.map((y) => (
              <TabsTrigger key={y.id} value={String(y.id)}>
                {y.nameAr}
                <Badge variant="secondary" className="ms-1.5 text-[10px]">
                  {y.locations.filter((l) => l.isActive).length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          {yards.map((y) => (
            <TabsContent key={y.id} value={String(y.id)} className="space-y-4 pt-2">
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  {t("yardSchematicMap")}
                </div>
                <YardMap yard={y} />
              </div>

              <div className="rounded-lg border overflow-x-auto">
                <Table className="min-w-[920px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20 text-start">{t("colCode")}</TableHead>
                      <TableHead className="text-start">{t("colName")}</TableHead>
                      <TableHead className="w-32 text-start">{t("colSegment")}</TableHead>
                      <TableHead className="w-20 text-center">{t("colCounting")}</TableHead>
                      <TableHead className="w-20 text-center">{t("colGrade")}</TableHead>
                      <TableHead className="w-28 text-start">{t("colSize")}</TableHead>
                      <TableHead className="w-24 text-start">{t("colSteelClassification")}</TableHead>
                      <TableHead className="w-24 text-center">{t("colPosition")}</TableHead>
                      <TableHead className="w-20 text-center">{t("colStatus")}</TableHead>
                      {canManage && (
                        <TableHead className="w-24 text-center" aria-label={t("actions")} />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {y.locations.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canManage ? 10 : 9}
                          className="h-24 text-center text-muted-foreground"
                        >
                          {t("noLocationsInYard")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      y.locations.map((l) => (
                        <TableRow key={l.id} className={cn(!l.isActive && "opacity-55")}>
                          <TableCell className="text-start font-mono text-sm font-semibold">
                            {l.code}
                          </TableCell>
                          <TableCell className="text-start font-medium">{l.nameAr}</TableCell>
                          <TableCell className="text-start">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  SEGMENT_META[l.segment].dot,
                                )}
                              />
                              <span className="text-xs">
                                {tEnums(`stockSegment.${l.segment}`)}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {t(segmentUnitKey(l.segment))}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {segmentGradeLabel(l.segment)}
                          </TableCell>
                          <TableCell className="text-start text-xs">
                            {l.expectedSize ? l.expectedSize.displayName : t("emDash")}
                          </TableCell>
                          <TableCell className="text-start text-xs">
                            {l.expectedClassification ? (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                {l.expectedClassification.code}
                              </Badge>
                            ) : (
                              t("emDash")
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs tabular-nums" dir="ltr">
                            r{l.gridRow}·c{l.gridCol}
                            {l.gridSpan > 1 ? `×${l.gridSpan}` : ""}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={l.isActive ? "default" : "secondary"}>
                              {l.isActive ? t("statusActive") : t("statusInactive")}
                            </Badge>
                          </TableCell>
                          {canManage && (
                            <TableCell className="text-center">
                              <div className="flex justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleEdit(l)}
                                  aria-label={t("edit")}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleDelete(l)}
                                  aria-label={t("delete")}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {canManage && (
        <StockLocationFormDialog
          open={dialogOpen}
          onOpenChange={(next) => {
            setDialogOpen(next);
            if (!next) setEditLocation(null);
          }}
          onSuccess={fetchData}
          yards={yardOptions}
          sizes={sizes}
          classifications={classifications}
          editData={editLocation}
          defaultYardId={activeYard ? Number(activeYard) : undefined}
        />
      )}
    </div>
  );
}
