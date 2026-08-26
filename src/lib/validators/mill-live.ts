import { z } from "zod";

export const millLiveProductSizeSchema = z.object({
  sizeId: z.number().int().positive("invalidData"),
});

export type MillLiveProductSizeInput = z.infer<typeof millLiveProductSizeSchema>;
