import { z } from 'zod';

// Shared Zod schema for the popularity override POST body. Lives in a plain module
// (not +server.ts) because SvelteKit rejects non-handler exports from route
// files at runtime — importing it here keeps both the route and its test valid.
export const PopularityBodySchema = z.object({ popularity_proxy: z.number().min(0).max(100) });
