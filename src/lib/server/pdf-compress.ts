import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const PDF_COMPRESS_TIMEOUT_MS = 30_000;

function ghostscriptCandidates(): string[] {
  if (process.platform === "win32") {
    return ["gswin64c", "gswin32c", "gs"];
  }
  return ["gs"];
}

async function runGhostscript(
  executable: string,
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await execFileAsync(
    executable,
    [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      "-dPDFSETTINGS=/ebook",
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      "-dDetectDuplicateImages=true",
      "-dCompressFonts=true",
      "-dSubsetFonts=true",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ],
    { timeout: PDF_COMPRESS_TIMEOUT_MS, windowsHide: true },
  );
}

export async function compressPdfBuffer(buffer: Buffer): Promise<Buffer | null> {
  const workDir = path.join(tmpdir(), `steel-erp-pdf-${randomUUID()}`);
  const inputPath = path.join(workDir, "input.pdf");
  const outputPath = path.join(workDir, "output.pdf");

  await mkdir(workDir, { recursive: true });
  try {
    await writeFile(inputPath, buffer);

    for (const executable of ghostscriptCandidates()) {
      try {
        await runGhostscript(executable, inputPath, outputPath);
        const compressed = await readFile(outputPath);
        return compressed.length > 0 && compressed.length < buffer.length
          ? compressed
          : null;
      } catch {
        // Try the next common executable name. If none exist, compression is skipped.
      }
    }

    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
