"use client";

import { useState, useEffect, useCallback } from "react";
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
import { StockLocationFormDialog } from "./stock-location-form-dialog";
import {
  SEGMENT_META,
  segmentUnitLabel,
  segmentGradeLabel,
  type Segment,
  type Yard,
  type StockLocation,
  type SizeOption,
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

/** Schematic grid preview of one yard, driven by gridRow/gridCol/gridSpan. */
function YardMap({ yard }: { yard: Yard }) {
  const active = yard.locations.filter((l) => l.isActive);
  if (active.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        لا توجد مواقع نشطة في هذه الساحة
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
              title={`${l.nameAr} — ${SEGMENT_META[l.segment].label}`}
            >
              <div className="font-mono text-sm font-bold leading-tight">
                {l.code}
              </div>
              <div className="truncate text-[10px] opacity-80" dir="rtl">
                {l.nameAr}
              </div>
              <div className="text-[10px] font-medium opacity-70">
                {l.expectedSize ? l.expectedSize.displayName : segmentUnitLabel(l.segment)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SegmentLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {(Object.keys(SEGMENT_META) as Segment[]).map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", SEGMENT_META[s].dot)} />
          {SEGMENT_META[s].label}
        </div>
      ))}
    </div>
  );
}

export function StockLocationManager() {
  const [yards, setYards] = useState<Yard[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
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
        setCanManage(!!json.data.canManage);
        setActiveYard((prev) =>
          prev && normalized.some((y) => String(y.id) === prev)
            ? prev
            : normalized[0]
              ? String(normalized[0].id)
              : "",
        );
      } else {
        toast.error(json.error || "خطأ في جلب المواقع");
      }
    } catch {
      toast.error("خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  }, []);

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
      ? `الموقع «${loc.nameAr}» عليه حركات — سيتم إيقافه (لا حذف). متابعة؟`
      : `حذف الموقع «${loc.nameAr}» نهائياً؟`;
    if (!window.confirm(message)) return;
    try {
      const res = await fetch(`/api/stock/locations/${loc.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || "تعذّر الحذف");
        return;
      }
      toast.success(json.data?.deactivated ? "تم إيقاف الموقع" : "تم حذف الموقع");
      void fetchData();
    } catch {
      toast.error("خطأ في الاتصال");
    }
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
            إضافة موقع
          </Button>
        )}
      </div>

      {yards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <Warehouse className="mx-auto mb-2 h-8 w-8 opacity-40" />
          لا توجد ساحات مضبوطة
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
                  خريطة الساحة التخطيطية
                </div>
                <YardMap yard={y} />
              </div>

              <div className="rounded-lg border overflow-x-auto">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20 text-start">الكود</TableHead>
                      <TableHead className="text-start">الاسم</TableHead>
                      <TableHead className="w-32 text-start">التصنيف</TableHead>
                      <TableHead className="w-20 text-center">العدّ</TableHead>
                      <TableHead className="w-20 text-center">النخب</TableHead>
                      <TableHead className="w-28 text-start">المقاس</TableHead>
                      <TableHead className="w-24 text-center">الموضع</TableHead>
                      <TableHead className="w-20 text-center">الحالة</TableHead>
                      {canManage && (
                        <TableHead className="w-24 text-center" aria-label="إجراءات" />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {y.locations.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canManage ? 9 : 8}
                          className="h-24 text-center text-muted-foreground"
                        >
                          لا توجد مواقع في هذه الساحة
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
                              <span className="text-xs">{SEGMENT_META[l.segment].label}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {segmentUnitLabel(l.segment)}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {segmentGradeLabel(l.segment)}
                          </TableCell>
                          <TableCell className="text-start text-xs">
                            {l.expectedSize ? l.expectedSize.displayName : "—"}
                          </TableCell>
                          <TableCell className="text-center text-xs tabular-nums" dir="ltr">
                            r{l.gridRow}·c{l.gridCol}
                            {l.gridSpan > 1 ? `×${l.gridSpan}` : ""}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={l.isActive ? "default" : "secondary"}>
                              {l.isActive ? "نشط" : "موقوف"}
                            </Badge>
                          </TableCell>
                          {canManage && (
                            <TableCell className="text-center">
                              <div className="flex justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleEdit(l)}
                                  aria-label="تعديل"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleDelete(l)}
                                  aria-label="حذف"
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
          editData={editLocation}
          defaultYardId={activeYard ? Number(activeYard) : undefined}
        />
      )}
    </div>
  );
}
