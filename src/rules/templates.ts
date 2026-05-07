import type { TemplateContext } from './types.js';

export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function resolveTemplate(template: string, context: TemplateContext): string {
  return template
    .replace(/\{\{weekNumber\}\}/g, String(context.weekNumber))
    .replace(/\{\{year\}\}/g, String(context.year))
    .replace(/\{\{submittedBy\}\}/g, context.submittedBy ?? '')
    .replace(/\{\{tag\}\}/g, context.tag ?? '')
    .replace(/\{\{groupName\}\}/g, context.groupName ?? '');
}
