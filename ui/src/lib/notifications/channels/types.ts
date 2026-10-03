import type { AlertType, ChannelId } from '$lib/notifications/config.js';

export interface ApprovalPayload {
  kind: 'approve' | 'review' | 'video_review' | 'playlist_message';
  token: string;
  approveUrl?: string;   // present when kind==='approve' or 'video_review'
  denyUrl: string;
  editUrl: string;
  reviewReason?: string; // present when kind==='review'
  snoozeUrl?: string;    // present when kind==='video_review'
  previewUrl?: string;   // approve/review: read-only digest 2.0 preview
  /** video_review only: how many picks still need a human answer, and how many are ready. */
  needsDecision?: number;
  ready?: number;
  /** playlist_message only. */
  author?: string;
  song?: string;
  text?: string;
}

export interface AlertPayload {
  alertType: AlertType;
  title: string;
  message: string;
  link?: string;
  approval?: ApprovalPayload;
}

export interface ChannelDeps {
  fetchFn?: typeof fetch;
  botControlUrl?: string;
}

export interface Channel {
  id: ChannelId;
  capabilities: Array<'alert' | 'approval'>;
  isConfigured(cfg: unknown): boolean;
  sendAlert(cfg: unknown, p: AlertPayload, deps: ChannelDeps): Promise<{ ok: boolean; error?: string }>;
}
