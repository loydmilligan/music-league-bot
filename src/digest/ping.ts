/**
 * A one-shot "does sending even work" ping.
 *
 * Every Store method in this whatsapp-web.js version throws `r: r`, and it is
 * unknown whether sendMessage shares that fate. Before a real digest is ever
 * sent, this puts one inane message through the exact guarded send path to a
 * chosen group — proving both that sendMessage works and that the guard resolves
 * the target correctly.
 *
 * Off unless DIGEST_PING_TARGET is set. Routes through the guard in live mode, so
 * a non-@g.us target is refused just as a real send would be.
 */
import type { SendGuardEnv } from '../whatsapp/sendGuard.js';

export interface PingPlan {
  env: SendGuardEnv;
  leagueSlug: string;
  text: string;
}

export function resolvePing(processEnv: Record<string, string | undefined>): PingPlan | null {
  const target = processEnv.DIGEST_PING_TARGET?.trim();
  if (!target) return null;

  return {
    env: { mode: 'live', targets: { ping: target } },
    leagueSlug: 'ping',
    text: processEnv.DIGEST_PING_TEXT?.trim() || '🎧 auto-post wiring test — please ignore',
  };
}
