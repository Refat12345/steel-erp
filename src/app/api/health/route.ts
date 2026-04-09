import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbConnected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch {
    /* db unreachable */
  }

  const status = dbConnected ? "ok" : "degraded";
  const code = dbConnected ? 200 : 503;

  return NextResponse.json(
    { status, timestamp: new Date().toISOString(), dbConnected },
    { status: code },
  );
}
