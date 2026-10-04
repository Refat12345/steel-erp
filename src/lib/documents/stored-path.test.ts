import path from "path";
import { describe, expect, it } from "vitest";
import { isSharedLibraryRelativePath, resolveStoredDocumentPath } from "./stored-path";

describe("shared library paths", () => {
  it("recognizes library paths and ignores contract uploads", () => {
    expect(isSharedLibraryRelativePath("uploads/documents/4/file.pdf")).toBe(true);
    expect(isSharedLibraryRelativePath("uploads/Documents/4/file.pdf")).toBe(true);
    expect(isSharedLibraryRelativePath("uploads/contracts/file.pdf")).toBe(false);
  });

  it("resolves a file only inside its own folder", () => {
    const resolved = resolveStoredDocumentPath("uploads/documents/4/abc.pdf", 4);
    expect(resolved).toBe(path.resolve(process.cwd(), "uploads", "documents", "4", "abc.pdf"));
    expect(resolveStoredDocumentPath("uploads/documents/4/../5/abc.pdf", 4)).toBeNull();
    expect(resolveStoredDocumentPath("uploads/documents/9/abc.pdf", 4)).toBeNull();
    expect(resolveStoredDocumentPath("uploads/contracts/abc.pdf", 4)).toBeNull();
  });
});
