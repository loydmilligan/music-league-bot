export interface TemplateContext {
  weekNumber: number;
  year: number;
  submittedBy?: string;
  tag?: string;
  groupName?: string;
}

export interface RuleMatch {
  name: string;
  spotify?: string;
  youtube?: string;
}
