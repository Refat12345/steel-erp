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
import { Plus, Search, Eye, FileText, ChevronLeft, ChevronRight } from "lucide-react";

interface Contract {
  contractNumber: string;
  customerId: number;
  status: string;
  notes: string | null;
  createdAt: string;
  customer: {
    id: number;
    code: string;
    fullName: string;
    phonePrimary: string;
  };
  _count: { attachments: number };
}

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  active: { label: "نشط", variant: "default" },
  suspended: { label: "معلّق", variant: "destructive" },
  closed: { label: "مغلق", variant: "secondary" },
};

export function ContractList() {
  const { data: session } = useSession();
  const canCreateContract = sessionHasPermission(session, "contract.create");
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/contracts?${params}`);
      const json = await res.json();
      if (json.success) {
        setContracts(json.data);
        setTotal(json.total);
      }
    } catch {
      toast.error("خطأ في جلب بيانات العقود");
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(fetchContracts, 300);
    return () => clearTimeout(timer);
  }, [fetchContracts]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم العقد أو اسم العميل..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9" 
          />
        </div>
        {canCreateContract && (
          <Button onClick={() => router.push("/contracts/new")} size="sm">
            <Plus className="h-4 w-4" />
            عقد جديد
          </Button>
        )}
      </div>

      {/* Table — single horizontal scroll inside <Table>; avoid nested overflow+x table-fixed RTL glitches */}
      <div className="rounded-lg border">
        <Table className="w-full min-w-[800px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[7.5rem] text-start">رقم العقد</TableHead>
              <TableHead className="w-[11rem] max-w-[11rem] text-start">العميل</TableHead>
              <TableHead className="w-[7.5rem] text-start">رمز العميل</TableHead>
              <TableHead dir="ltr" className="w-36 max-w-36 text-start">
                الهاتف
              </TableHead>
              <TableHead dir="ltr" className="w-36 max-w-36 text-start">
                تاريخ الإنشاء
              </TableHead>
              <TableHead className="w-12 text-center">المرفقات</TableHead>
              <TableHead className="w-20 text-center">الحالة</TableHead>
              <TableHead className="w-16 text-center" aria-label="عرض" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : contracts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="h-8 w-8 opacity-40" />
                    {search ? "لا توجد نتائج" : "لا توجد عقود — أنشئ أول عقد"}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contracts.map((c) => {
                const st = statusMap[c.status] || statusMap.active;
                return (
                  <TableRow key={c.contractNumber}>
                    <TableCell className="w-[7.5rem] text-start font-mono text-sm font-semibold">
                      {c.contractNumber}
                    </TableCell>
                    <TableCell className="w-[11rem] max-w-[11rem] text-start font-medium">
                      <span className="block truncate" title={c.customer.fullName}>
                        {c.customer.fullName}
                      </span>
                    </TableCell>
                    <TableCell className="w-[7.5rem] text-start font-mono text-xs">
                      {c.customer.code}
                    </TableCell>
                    <TableCell
                      dir="ltr"
                      className="w-36 max-w-36 text-start text-xs tabular-nums"
                    >
                      {c.customer.phonePrimary}
                    </TableCell>
                    <TableCell
                      dir="ltr"
                      className="w-36 max-w-36 text-start font-mono text-xs tabular-nums"
                    >
                      {new Date(c.createdAt).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="w-12 text-center align-middle tabular-nums">
                      <div className="flex justify-center">{c._count.attachments}</div>
                    </TableCell>
                    <TableCell className="w-20 text-center align-middle">
                      <div className="flex justify-center">
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="w-16 text-center align-middle">
                      <div className="flex justify-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            router.push(`/contracts/${c.contractNumber}`)
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
    </div>
  );
}
