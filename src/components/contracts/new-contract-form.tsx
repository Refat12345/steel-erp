"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CustomerFormDialog } from "@/components/contracts/customer-form-dialog";
import {
  contractCreateSchema,
  type ContractCreateInput,
} from "@/lib/validators/contract";
import { sessionHasPermission } from "@/lib/client-permissions";
import { compressImage } from "@/lib/compress-image";
import { formatInteger } from "@/lib/number-format";
import { translateValidationMessage } from "@/lib/i18n/validation-message";
import {
  Loader2,
  Upload,
  FileCheck,
  X,
  Plus,
  Search,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { getTextDirection, type Locale } from "@/i18n/config";

interface CustomerOption {
  id: number;
  code: string;
  fullName: string;
  nationalId: string;
}

export function NewContractForm() {
  const t = useTranslations("contracts");
  const tValidation = useTranslations("validation");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const customerComboRef = useRef<HTMLDivElement>(null);

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(
    null,
  );
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

  useEffect(() => {
    if (!showCustomerDropdown) return;

    const onPointerDown = (event: PointerEvent) => {
      const root = customerComboRef.current;
      const target = event.target as Node | null;
      if (root && target && !root.contains(target)) {
        setShowCustomerDropdown(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showCustomerDropdown]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw) return;

    setUploading(true);
    try {
      const file = raw.type.startsWith("image/")
        ? await compressImage(raw)
        : raw;
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
      toast.success(t("uploadSuccess"));
    } catch {
      toast.error(t("errorUpload"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (data: ContractCreateInput) => {
    if (!uploadedFile) {
      toast.error(t("toastSignedRequired"));
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

      toast.success(t("createSuccess", { number: json.data.contractNumber }));
      router.push("/contracts");
    } catch {
      toast.error(t("errorConnection"));
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

  if (sessionStatus === "loading") {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6 min-w-0">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!sessionHasPermission(session, "contract.create")) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6 min-w-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/contracts")}
          >
            <BackIcon className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight">
            {t("newContractTitle")}
          </h1>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("noCreatePermission")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <BackIcon className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {t("newContractTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("newContractSubtitle")}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Customer Selection — overflow-visible + z-index so the list is not clipped by Card or covered by cards below */}
        <Card className="relative z-20 overflow-visible">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("customer")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 overflow-visible">
            {selectedCustomer ? (
              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {selectedCustomer.fullName}
                  </p>
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
              <div ref={customerComboRef} className="relative isolate">
                <div className="relative">
                  <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                  <Input
                    placeholder={t("searchCustomerCombo")}
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setShowCustomerDropdown(false);
                      }
                    }}
                    className="pe-9"
                    autoComplete="off"
                    aria-expanded={showCustomerDropdown}
                    aria-haspopup="listbox"
                  />
                </div>
                {showCustomerDropdown && (
                  <div
                    className="absolute start-0 end-0 top-full z-50 mt-1 max-h-[min(22rem,70vh)] min-h-0 overflow-y-auto overscroll-contain rounded-lg border bg-popover py-1 shadow-lg ring-1 ring-foreground/10"
                    role="listbox"
                  >
                    {customers.length === 0 ? (
                      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                        {t("emptyNoResults")}
                      </div>
                    ) : (
                      customers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => selectCustomer(c)}
                          className="flex w-full flex-col items-stretch gap-0.5 px-3 py-2.5 text-start text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        >
                          <span className="font-medium leading-snug">
                            {c.fullName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {c.code}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {errors.customerId && (
                  <p className="text-xs text-destructive mt-1">
                    {translateValidationMessage(tValidation, errors.customerId.message)}
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
              {t("newCustomer")}
            </Button>
          </CardContent>
        </Card>

        {/* Attachment */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("signedCopyRequired")}</CardTitle>
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
                    {t("fileSizeKb", {
                      size: formatInteger(uploadedFile.size / 1024),
                    })}
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
                  {uploading ? t("uploading") : t("uploadSignedHint")}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  {t("uploadFormatsHint")}
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
            <CardTitle className="text-base">{t("notes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              {...register("notes")}
              placeholder={t("notesOptional")}
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
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            {t("createContract")}
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
