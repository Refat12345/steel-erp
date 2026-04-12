import { prisma } from "@/lib/db";

export async function listActiveSizes() {
  return prisma.sizeLookup.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      displayName: true,
      isBundleType: true,
      isSpecialRatio: true,
    },
  });
}
