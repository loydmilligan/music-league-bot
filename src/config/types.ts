import { z } from 'zod';

export const ruleWhenSchema = z.object({
  command: z.string().optional(),
  tag: z.string().optional(),
  submittedBy: z.string().optional(),
  groupId: z.string().optional(),
}).refine(
  (w) => Object.values(w).some((v) => v !== undefined),
  { message: 'A rule "when" clause must specify at least one condition' },
);

export const rulePlaylistSchema = z.object({
  spotify: z.string().optional(),
  youtube: z.string().optional(),
}).refine(
  (p) => p.spotify !== undefined || p.youtube !== undefined,
  { message: 'A rule "playlist" must specify at least one of spotify or youtube' },
);

export const ruleSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  when: ruleWhenSchema,
  playlist: rulePlaylistSchema,
});

export const notificationsSchema = z.object({
  onFailure: z.boolean().default(true),
  onLowConfidence: z.boolean().default(true),
  confidenceThreshold: z.number().min(0).max(1).default(0.9),
  recipients: z.enum(['me', 'submitter', 'me-and-submitter']).default('me'),
});

export const defaultsSchema = z.object({
  requireCommandPrefix: z.boolean().optional(),
  commandPrefix: z.string().optional(),
  dedupeScope: z.enum(['playlist', 'global', 'week']).optional(),
});

export type Defaults = z.infer<typeof defaultsSchema>;

export const rulesConfigSchema = z.object({
  defaults: defaultsSchema,
  rules: z.array(ruleSchema),
  notifications: notificationsSchema.optional(),
});

export type RuleWhen = z.infer<typeof ruleWhenSchema>;
export type RulePlaylist = z.infer<typeof rulePlaylistSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Notifications = z.infer<typeof notificationsSchema>;
export type RulesConfig = z.infer<typeof rulesConfigSchema>;
