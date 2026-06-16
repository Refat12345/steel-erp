"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Plus, Search, Eye, Package, ChevronLeft, ChevronRight } from "lucide-react";

interface PieceLine {
  id: number;
  billetLengthM: number;
  contractedPieces: number;
}

interface BilletContract {
  contractNumber: string;
  supplierName: string;
  contractedWeightKg: string;
  status: string;
  contractDate: string;
  createdAt: string;
  pieceLines: PieceLine[];
  _count: { receipts: number };
}

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  Active: { label: "فعّال", variant: "default" },
  Completed: { label: "مكتمل", variant: "secondary" },
  Cancelled: { label: "ملغى", variant: "destructive" },
};

function formatKg(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function BilletContractList() {
  const { data: session } = useSession();
  const canCreate = sessionHasPermission(session, "billet.contract.create");
  const router = useRouter();
  const [contracts, setContracts] = useState<BilletContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/billet-contracts?${params}`);
      const json = await res.json();
      if (json.success) {
        setContracts(json.data);
        setTotal(json.total);
      }
    } catch {
      toast.error("خطأ في جلب عقود الموردين");
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    setPage(1);
  }, [search, status]);

  useEffect(() => {
    const timer = setTimeout(fetchContracts, 300);
    return () => clearTimeout(timer);
  }, [fetchContracts]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم العقد أو اسم المورّد..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v ?? "")}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="كل الحالات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">كل الحالات</SelectItem>
            <SelectItem value="Active">فعّال</SelectItem>
            <SelectItem value="Completed">مكتمل</SelectItem>
            <SelectItem value="Cancelled">ملغى</SelectItem>
          </SelectContent>
        </Select>
        {canCreate && (
          <Button onClick={() => router.push("/billet-contracts/new")} size="sm">
            <Plus className="h-4 w-4" />
            عقد مورّد جديد
          </Button>
        )}
      </div>

      <div className="rounded-lg border">
        <Table className="w-full min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28 text-start">رقم العقد</TableHead>
              <TableHead className="w-48 max-w-48 text-start">المورّد</TableHead>
              <TableHead className="w-32 text-start">الوزن الإجمالي (كغ)</TableHead>
              <TableHead className="w-40 text-start">القطع لكل طول</TableHead>
              <TableHead className="w-20 text-center">الاستلامات</TableHead>
              <TableHead className="w-20 text-center">الحالة</TableHead>
              <TableHead className="w-14 text-center" aria-label="عرض" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : contracts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Package className="h-8 w-8 opacity-40" />
                    {search || status ? "لا توجد نتائج" : "لا توجد عقود — أنشئ أول عقد مورّد"}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contracts.map((c) => {
                const st = statusMap[c.status] || statusMap.Active;
                return (
                  <TableRow key={c.contractNumber}>
                    <TableCell className="text-start font-mono text-sm font-semibold">
                      {c.contractNumber}
                    </TableCell>
                    <TableCell className="max-w-48 text-start font-medium">
                      <span className="block truncate" title={c.supplierName}>
                        {c.supplierName}
                      </span>
                    </TableCell>
                    <TableCell className="text-start tabular-nums">
                      {formatKg(c.contractedWeightKg)}
                    </TableCell>
                    <TableCell className="text-start text-xs">
                      {c.pieceLines.length === 0
                        ? "—"
                        : c.pieceLines
                            .map((l) => `${l.billetLengthM}م: ${l.contractedPieces}`)
                            .join("، ")}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {c._count.receipts}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            router.push(`/billet-contracts/${c.contractNumber}`)
                          }
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            صفحة {page} من {totalPages} — {total} عقد
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
