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
  /** Flag an owner's text forward straight away, with no follow-up prefix message. Only used when the sender owns just this award. */
  autoFlag?: boolean;
  /** Id of the person who makes the poster instead of the owner: they get the prompt and kit, and may send `<prefix> poster` / `<prefix> kit`. */
  posterMaker?: string;
  /** What the owner is told once the picks are complete when posterMaker is set. */
  posterPendingNote?: string;
  /** OpenRouter image model; when set, the bot makes the poster itself once the picks are complete. */
  genModel?: string;
  /** Redos an owner may run per round before each further redo needs the posterMaker's OK. Default 2. */
  ownerRegens?: number;
}

export interface AwardsConfig {
  postGroup: string;
  /** chat_messages.group_name of the group being awarded. */
  groupName: string;
  leagueId: number;
  digestBaseUrl: string;
  recapBaseUrl: string;
  awards: AwardDef[];
  /** Owner/approver id (as listed in an AwardDef) -> display name used in approval replies. */
  names?: Record<string, string>;
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
  /** Claim mark, set before the send starts (never double-posts). */
  postedAt?: string;
  /** Set only after the send resolved; the Awards tab shows only rounds with sentAt. */
  sentAt?: string;
  /** The send threw after postedAt was set; approving again clears this and retries. */
  postFailed?: boolean;
  skipped?: string;
  /** Owner redos used this round. */
  regens?: number;
  /** An owner redo past the limit, waiting for the posterMaker's OK. */
  redoRequest?: { comment: string | null; at: string };
}
