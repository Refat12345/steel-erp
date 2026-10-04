import { describe, expect, it } from "vitest";
import { detectDocumentFile, documentDisplaysInline } from "./file-signature";

function bytes(source: string, prefix?: number[]): Buffer {
  return Buffer.concat([
    Buffer.from(prefix ?? []),
    Buffer.from(source),
  ]);
}

describe("detectDocumentFile", () => {
  it("accepts a pdf when the extension matches the header", () => {
    const detected = detectDocumentFile(Buffer.from("%PDF-1.7"), "report.pdf");
    expect(detected?.extension).toBe("pdf");
    expect(detected?.mimeType).toBe("application/pdf");
  });

  it("accepts an xlsx zip that contains an xl path", () => {
    const buffer = bytes("xl/workbook.xml", [0x50, 0x4b, 0x03, 0x04]);
    expect(detectDocumentFile(buffer, "sheet.xlsx")?.extension).toBe("xlsx");
  });

  it("rejects an xlsx that is really a word document", () => {
    const buffer = bytes("word/document.xml", [0x50, 0x4b, 0x03, 0x04]);
    expect(detectDocumentFile(buffer, "sheet.xlsx")).toBeNull();
  });

  it("rejects a renamed executable", () => {
    expect(detectDocumentFile(Buffer.from("MZ not a pdf"), "notes.pdf")).toBeNull();
  });

  it("treats pdf and images as viewable and office files as download-only", () => {
    expect(documentDisplaysInline("application/pdf")).toBe(true);
    expect(documentDisplaysInline("image/png")).toBe(true);
    expect(documentDisplaysInline("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(false);
    expect(documentDisplaysInline("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
  });

  it("accepts a legacy xls OLE header", () => {
    const buffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(detectDocumentFile(buffer, "old.xls")?.extension).toBe("xls");
  });
});
