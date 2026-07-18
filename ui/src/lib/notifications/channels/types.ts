import type { AlertType, ChannelId } from '$lib/notifications/config.js';

export interface ApprovalPayload {
  kind: 'approve' | 'review';
  token: string;
  approveUrl?: string;   // present when kind==='approve'
  denyUrl: string;
  editUrl: string;
  reviewReason?: string; // present when kind==='review'
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
