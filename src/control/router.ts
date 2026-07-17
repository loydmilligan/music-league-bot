/**
 * Pure request router for the bot's local control server. Kept separate from the
 * HTTP glue so the routing — including the safe mode default — is unit-tested.
 */

export type ControlAction =
  | { action: 'trigger' }
  | { action: 'send'; roundId: number; target: string; mode: 'live' | 'dry-run' }
  | { action: 'unknown'; reason: string };

export function parseControlRequest(method: string, path: string, body: unknown): ControlAction {
  if (method !== 'POST') return { action: 'unknown', reason: `method ${method} not allowed` };

  if (path === '/trigger') return { action: 'trigger' };

  if (path === '/send') {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.roundId !== 'number') return { action: 'unknown', reason: 'roundId (number) required' };
    if (typeof b.target !== 'string' || !b.target.trim()) {
      return { action: 'unknown', reason: 'target (string) required' };
    }
    // Default to dry-run and treat anything but the exact string 'live' as dry-run,
    // so a typo or omission can never cause a real send.
    const mode = b.mode === 'live' ? 'live' : 'dry-run';
    return { action: 'send', roundId: b.roundId, target: b.target.trim(), mode };
  }

  return { action: 'unknown', reason: `no route for ${method} ${path}` };
}
