// Shared zod schemas: HTTP bodies (PLAN §5), event payloads (§6), agent I/O (§8).
import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  env: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
