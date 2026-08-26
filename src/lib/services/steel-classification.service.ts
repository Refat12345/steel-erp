import { prisma } from "@/lib/db";
import { RETIRED_STEEL_CLASSIFICATION_CODES } from "@/lib/steel-classification-default";

/**
 * Active technical steel classifications offered on new selections
 * (B500B). B400DWR stays in the catalog as inactive history. Catalog is
 * seed-managed like SizeLookup; ordered for select dropdowns.
 */
export async function listActiveClassifications() {
  return prisma.steelClassification.findMany({
    where: {
      isActive: true,
      code: { notIn: [...RETIRED_STEEL_CLASSIFICATION_CODES] },
    },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      displayName: true,
      displayNameEn: true,
      grade: true,
    },
  });
}
