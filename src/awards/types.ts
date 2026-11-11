export interface AwardDef {
  key: string;
  prefix: string;
  name: string;
  /** Phone numbers or ids. */
  owners: string[];
  approvers: string[];
  day: number;
  window: 'round' | '7d';
  promptTemplate: string;
}

export interface AwardsConfig {
  postGroup: string;
  /** chat_messages.group_name of the group being awarded. */
  groupName: string;
  leagueId: number;
  digestBaseUrl: string;
  recapBaseUrl: string;
  awards: AwardDef[];
  /** Display name -> kit avatar filename. Default: lowercased, hyphenated name + .png. */
  avatars?: Record<string, string>;
}

export interface Candidate {
  n: number;
  who: string;
  authorId: string | null;
  text: string;
  ts: string;
  msgId: string | null;
  reactions: { emoji: string; who: string[] }[] | null;
}

export interface AwardRound {
  award: string;
  roundId: number;
  candidates: Candidate[];
  picks: { 1?: number; 2?: number; 3?: number };
  decidedAt?: string;
  poster?: string;
  approvals: string[];
  approvedAt?: string;
  postedAt?: string;
  skipped?: string;
}
