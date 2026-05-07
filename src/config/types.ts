import { z } from 'zod';

export const ruleWhenSchema = z.object({
  command: z.string().optional(),
  tag: z.string().optional(),
  submittedBy: z.string().optional(),
  groupId: z.string().optional(),
});

export const rulePlaylistSchema = z.object({
  spotify: z.string().optional(),
  youtube: z.string().optional(),
});

export const ruleSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  when: ruleWhenSchema,
  playlist: rulePlaylistSchema,
});

export const rulesConfigSchema = z.object({
  defaults: z.object({
    requireCommandPrefix: z.boolean().optional(),
    commandPrefix: z.string().optional(),
    dedupeScope: z.enum(['playlist', 'global', 'week']).optional(),
  }),
  rules: z.array(ruleSchema),
});

export type RuleWhen = z.infer<typeof ruleWhenSchema>;
export type RulePlaylist = z.infer<typeof rulePlaylistSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type RulesConfig = z.infer<typeof rulesConfigSchema>;
