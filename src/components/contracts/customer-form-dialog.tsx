"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  customerCreateSchema,
  type CustomerCreateInput,
} from "@/lib/validators/customer";
import { Loader2 } from "lucide-react";

const EMPTY_CUSTOMER_FORM: CustomerCreateInput = {
  fullName: "",
  fatherName: "",
  nationalId: "",
  phonePrimary: "",
  phoneSecondary: "",
  companyAddress: "",
  commercialRegistration: "",
  notes: "",
};

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editData?: {
    id: number;
    fullName: string;
    fatherName: string;
    nationalId: string;
    phonePrimary: string;
    phoneSecondary?: string | null;
    companyAddress: string;
    commercialRegistration?: string | null;
    notes?: string | null;
  };
}

export function CustomerFormDialog({
  open,
  onOpenChange,
  onSuccess,
  editData,
}: CustomerFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const isEdit = !!editData;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CustomerCreateInput>({
    resolver: zodResolver(customerCreateSchema),
    defaultValues: EMPTY_CUSTOMER_FORM,
  });

  // defaultValues apply only on first mount; dialog stays mounted → reset when opening for edit/create
  useEffect(() => {
    if (!open) return;
    if (editData) {
      reset({
        fullName: editData.fullName,
        fatherName: editData.fatherName,
        nationalId: editData.nationalId,
        phonePrimary: editData.phonePrimary,
        phoneSecondary: editData.phoneSecondary ?? "",
        companyAddress: editData.companyAddress,
        commercialRegistration: editData.commercialRegistration ?? "",
        notes: editData.notes ?? "",
      });
    } else {
      reset(EMPTY_CUSTOMER_FORM);
    }
  }, [open, editData, reset]);

  const onSubmit = async (data: CustomerCreateInput) => {
    setLoading(true);
    try {
      const url = isEdit ? `/api/customers/${editData.id}` : "/api/customers";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const json = await res.json();

      if (!json.success) {
        toast.error(json.error || "حدث خطأ");
        return;
      }

      if (json.data?.phoneWarning) {
        toast.warning(json.data.phoneWarning);
      }

      toast.success(isEdit ? "تم تحديث العميل" : "تم إنشاء العميل بنجاح");
      reset();
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error("حدث خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل عميل" : "إضافة عميل جديد"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "تعديل بيانات العميل" : "تسجيل عميل جديد في النظام"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">الاسم الكامل *</Label>
              <Input id="fullName" {...register("fullName")} />
              {errors.fullName && (
                <p className="text-xs text-destructive">{errors.fullName.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fatherName">اسم الأب *</Label>
              <Input id="fatherName" {...register("fatherName")} />
              {errors.fatherName && (
                <p className="text-xs text-destructive">{errors.fatherName.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nationalId">الرقم الوطني *</Label>
              <Input id="nationalId" {...register("nationalId")} dir="ltr" className="text-left" />
              {errors.nationalId && (
                <p className="text-xs text-destructive">{errors.nationalId.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phonePrimary">الهاتف الأساسي *</Label>
              <Input id="phonePrimary" {...register("phonePrimary")} dir="ltr" className="text-left" />
              {errors.phonePrimary && (
                <p className="text-xs text-destructive">{errors.phonePrimary.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phoneSecondary">الهاتف الثانوي</Label>
              <Input id="phoneSecondary" {...register("phoneSecondary")} dir="ltr" className="text-left" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="commercialRegistration">السجل التجاري</Label>
              <Input id="commercialRegistration" {...register("commercialRegistration")} dir="ltr" className="text-left" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="companyAddress">عنوان الشركة *</Label>
            <Input id="companyAddress" {...register("companyAddress")} />
            {errors.companyAddress && (
              <p className="text-xs text-destructive">{errors.companyAddress.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">ملاحظات</Label>
            <Textarea id="notes" {...register("notes")} rows={2} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}
              {isEdit ? "حفظ التعديلات" : "إضافة العميل"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
