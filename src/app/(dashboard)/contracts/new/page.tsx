"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomerFormDialog } from "@/components/contracts/customer-form-dialog";
import {
  contractCreateSchema,
  type ContractCreateInput,
} from "@/lib/validators/contract";
import {
  Loader2,
  Upload,
  FileCheck,
  X,
  Plus,
  Search,
  ArrowRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface CustomerOption {
  id: number;
  code: string;
  fullName: string;
  nationalId: string;
}

export default function NewContractPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);

  const [uploadedFile, setUploadedFile] = useState<{
    path: string;
    name: string;
    size: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ContractCreateInput>({
    resolver: zodResolver(contractCreateSchema),
  });

  const fetchCustomers = async (search = "") => {
    const params = new URLSearchParams({ active: "true", pageSize: "50" });
    if (search) params.set("search", search);
    const res = await fetch(`/api/customers?${params}`);
    const json = await res.json();
    if (json.success) setCustomers(json.data);
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (customerSearch) fetchCustomers(customerSearch);
    }, 200);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();

      if (!json.success) {
        toast.error(json.error);
        return;
      }

      setUploadedFile({
        path: json.data.filePath,
        name: json.data.fileName,
        size: json.data.fileSize,
      });
      toast.success("تم رفع الملف بنجاح");
    } catch {
      toast.error("خطأ في رفع الملف");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (data: ContractCreateInput) => {
    if (!uploadedFile) {
      toast.error("يجب رفع نسخة ممسوحة من العقد الموقّع");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          attachmentPath: uploadedFile.path,
          attachmentName: uploadedFile.name,
          attachmentSize: uploadedFile.size,
        }),
      });

      const json = await res.json();

      if (!json.success) {
        toast.error(json.error);
        return;
      }

      toast.success(`تم إنشاء العقد ${json.data.contractNumber} بنجاح`);
      router.push("/contracts");
    } catch {
      toast.error("حدث خطأ في الاتصال");
    } finally {
      setSubmitting(false);
    }
  };

  const selectCustomer = (c: CustomerOption) => {
    setSelectedCustomer(c);
    setValue("customerId", c.id);
    setCustomerSearch("");
    setShowCustomerDropdown(false);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">عقد جديد</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            إنشاء عقد بيع عام جديد
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Customer Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">العميل</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedCustomer ? (
              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                <div>
                  <p className="font-medium">{selectedCustomer.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedCustomer.code} — {selectedCustomer.nationalId}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setValue("customerId", 0 as unknown as number);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="ابحث عن عميل بالاسم أو الرقم الوطني..."
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    className="pr-9"
                  />
                </div>
                {showCustomerDropdown && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-lg max-h-48 overflow-auto">
                    {customers.length === 0 ? (
                      <div className="p-3 text-center text-sm text-muted-foreground">
                        لا توجد نتائج
                      </div>
                    ) : (
                      customers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectCustomer(c)}
                          className="w-full text-right px-3 py-2 hover:bg-muted transition-colors text-sm"
                        >
                          <span className="font-medium">{c.fullName}</span>
                          <span className="text-muted-foreground mr-2 text-xs">
                            {c.code}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {errors.customerId && (
                  <p className="text-xs text-destructive mt-1">
                    {errors.customerId.message}
                  </p>
                )}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCustomerDialogOpen(true)}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              عميل جديد
            </Button>
          </CardContent>
        </Card>

        {/* Attachment */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              نسخة العقد الموقّع *
            </CardTitle>
          </CardHeader>
          <CardContent>
            {uploadedFile ? (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                <FileCheck className="h-5 w-5 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {uploadedFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(uploadedFile.size / 1024).toFixed(0)} كيلوبايت
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setUploadedFile(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/30">
                {uploading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="h-8 w-8 text-muted-foreground" />
                )}
                <p className="text-sm text-muted-foreground">
                  {uploading
                    ? "جاري الرفع..."
                    : "اضغط لرفع نسخة ممسوحة من العقد"}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  PDF أو صورة أو Word — حد أقصى 10 ميغابايت
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </label>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ملاحظات</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              {...register("notes")}
              placeholder="ملاحظات إضافية (اختياري)"
              rows={3}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            إلغاء
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            إنشاء العقد
          </Button>
        </div>
      </form>

      <CustomerFormDialog
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        onSuccess={() => {
          fetchCustomers();
        }}
      />
    </div>
  );
}
