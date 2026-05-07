import type { RulesConfig, Rule } from '../config/types.js';
import type { TemplateContext, RuleMatch } from './types.js';
import { resolveTemplate } from './templates.js';

interface SubmissionContext {
  command: string;
  tags: string[];
  submittedBy?: string;
  groupId?: string;
}

function ruleMatches(rule: Rule, submission: SubmissionContext): boolean {
  const { when } = rule;

  if (when.command !== undefined && when.command !== submission.command) return false;

  if (when.tag !== undefined && !submission.tags.includes(when.tag)) return false;

  if (when.submittedBy !== undefined) {
    if (when.submittedBy === '*') {
      if (!submission.submittedBy) return false;
    } else if (when.submittedBy !== submission.submittedBy) {
      return false;
    }
  }

  if (when.groupId !== undefined && when.groupId !== submission.groupId) return false;

  return true;
}

export function applyRules(
  config: RulesConfig,
  submission: SubmissionContext,
  context: TemplateContext,
): RuleMatch[] {
  return config.rules
    .filter((rule) => rule.enabled && ruleMatches(rule, submission))
    .map((rule) => ({
      name: rule.name,
      spotify: rule.playlist.spotify
        ? resolveTemplate(rule.playlist.spotify, context)
        : undefined,
      youtube: rule.playlist.youtube
        ? resolveTemplate(rule.playlist.youtube, context)
        : undefined,
    }));
}
