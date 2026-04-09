import { describe, it, expect } from "vitest";
import {
  contractCreateSchema,
  contractCreateWithAttachmentSchema,
  contractUpdateSchema,
  attachmentUploadSchema,
} from "./contract";

describe("contractCreateSchema", () => {
  it("accepts valid input", () => {
    const result = contractCreateSchema.safeParse({ customerId: 1 });
    expect(result.success).toBe(true);
  });

  it("rejects missing customerId", () => {
    const result = contractCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects non-positive customerId", () => {
    const result = contractCreateSchema.safeParse({ customerId: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer customerId", () => {
    const result = contractCreateSchema.safeParse({ customerId: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("contractCreateWithAttachmentSchema", () => {
  it("accepts valid input with attachment", () => {
    const result = contractCreateWithAttachmentSchema.safeParse({
      customerId: 1,
      attachmentPath: "uploads/file.pdf",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachmentName).toBe("");
      expect(result.data.attachmentSize).toBe(0);
    }
  });

  it("rejects missing attachmentPath", () => {
    const result = contractCreateWithAttachmentSchema.safeParse({
      customerId: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty attachmentPath", () => {
    const result = contractCreateWithAttachmentSchema.safeParse({
      customerId: 1,
      attachmentPath: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("contractUpdateSchema", () => {
  it("accepts status change with reason", () => {
    const result = contractUpdateSchema.safeParse({
      status: "suspended",
      statusReason: "تأخر في الدفع",
    });
    expect(result.success).toBe(true);
  });

  it("accepts notes-only update", () => {
    const result = contractUpdateSchema.safeParse({ notes: "ملاحظة جديدة" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status value", () => {
    const result = contractUpdateSchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts empty object", () => {
    const result = contractUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("attachmentUploadSchema", () => {
  it("accepts valid attachment data", () => {
    const result = attachmentUploadSchema.safeParse({
      filePath: "uploads/doc.pdf",
      fileName: "عقد.pdf",
      fileSize: 1024,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing filePath", () => {
    const result = attachmentUploadSchema.safeParse({
      fileName: "file.pdf",
      fileSize: 0,
    });
    expect(result.success).toBe(false);
  });

  it("defaults fileSize to 0", () => {
    const result = attachmentUploadSchema.safeParse({
      filePath: "uploads/f.pdf",
      fileName: "f.pdf",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fileSize).toBe(0);
    }
  });
});
