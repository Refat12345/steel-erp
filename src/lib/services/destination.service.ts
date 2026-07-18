import { prisma } from "@/lib/db";

const MAX_DESTINATION_RESULTS = 50;

export interface DestinationSearchParams {
  search?: string;
  limit?: number;
}

export async function listActiveDestinations({
  search = "",
  limit = MAX_DESTINATION_RESULTS,
}: DestinationSearchParams = {}) {
  const normalizedSearch = search.trim();
  const take = Math.min(Math.max(limit, 1), MAX_DESTINATION_RESULTS);

  return prisma.destination.findMany({
    where: {
      isActive: true,
      ...(normalizedSearch
        ? {
            OR: [
              { name: { contains: normalizedSearch, mode: "insensitive" as const } },
              { details: { contains: normalizedSearch, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take,
    select: {
      id: true,
      name: true,
      nameEn: true,
      details: true,
    },
  });
}
