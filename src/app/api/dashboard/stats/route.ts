import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-utils";
import { getDashboardStatsCached } from "@/lib/dashboard-stats";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await getApiSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "غير مصرح بالدخول" }, { status: 401 });
  }

  try {
    const data = await getDashboardStatsCached();
    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error({ err }, "dashboard stats error");
    return NextResponse.json({ success: false, error: "خطأ في جلب الإحصاءات" }, { status: 500 });
  }
}
