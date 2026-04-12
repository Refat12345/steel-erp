"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paymentCreateSchema, type PaymentCreateInput } from "@/lib/validators/payment";

interface Customer {
  id: number;
  code: string;
  fullName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RecordPaymentDialog({ open, onOpenChange, onSuccess }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<PaymentCreateInput>({
    resolver: zodResolver(paymentCreateSchema),
    defaultValues: {
      customerId: 0,
      amount: 0,
      method: "CASH",
      paymentDate: new Date().toISOString().slice(0, 10),
      referenceNumber: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    fetch("/api/payments?scope=customers")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setCustomers(json.data);
      })
      .catch(() => toast.error("خطأ في جلب قائمة العملاء"));
  }, [open]);

  const selectedCustomerId = watch("customerId");

  async function onSubmit(data: PaymentCreateInput) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("تم تسجيل الدفعة بنجاح");
        reset();
        onOpenChange(false);
        onSuccess();
      } else {
        toast.error(json.error || "خطأ في تسجيل الدفعة");
      }
    } catch {
      toast.error("خطأ في الاتصال بالخادم");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>تسجيل دفعة مالية</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>العميل</Label>
            <Select
              value={selectedCustomerId ? String(selectedCustomerId) : ""}
              onValueChange={(v) => setValue("customerId", parseInt(v, 10), { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر العميل..." />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.fullName} ({c.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.customerId && (
              <p className="text-sm text-destructive">{errors.customerId.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="amount">المبلغ ($)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                {...register("amount", { valueAsNumber: true })}
                aria-invalid={!!errors.amount}
              />
              {errors.amount && (
                <p className="text-sm text-destructive">{errors.amount.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>طريقة الدفع</Label>
              <Select
                value={watch("method")}
                onValueChange={(v) =>
                  setValue("method", v as PaymentCreateInput["method"], { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">نقدي</SelectItem>
                  <SelectItem value="BANK_TRANSFER">تحويل بنكي</SelectItem>
                  <SelectItem value="CHECK">شيك</SelectItem>
                </SelectContent>
              </Select>
              {errors.method && (
                <p className="text-sm text-destructive">{errors.method.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="paymentDate">تاريخ الدفع</Label>
              <Input
                id="paymentDate"
                type="date"
                {...register("paymentDate")}
                aria-invalid={!!errors.paymentDate}
              />
              {errors.paymentDate && (
                <p className="text-sm text-destructive">{errors.paymentDate.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="referenceNumber">رقم المرجع</Label>
              <Input
                id="referenceNumber"
                {...register("referenceNumber")}
                placeholder="اختياري"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">ملاحظات</Label>
            <Textarea
              id="notes"
              {...register("notes")}
              rows={2}
              placeholder="ملاحظات إضافية (اختياري)"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              إلغاء
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "جارٍ التسجيل..." : "تسجيل الدفعة"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
