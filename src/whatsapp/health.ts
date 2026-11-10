/**
 * Liveness probe for the WhatsApp Web session. The container can stay "Up" while
 * the Chromium page behind whatsapp-web.js has crashed (2026-11-09: renderer gone,
 * every send hung). getState() round-trips through that page, so a crash shows
 * up here as a throw or a hang. Polled by scripts/wa-watchdog.mjs via GET /health.
 */
export interface HealthResult {
  ok: boolean;
  state: string | null;
  ms: number;
  reason?: string;
}

export async function probeHealth(
  getState: () => Promise<string | null>,
  timeoutMs = 10_000,
): Promise<HealthResult> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    const state = await Promise.race([getState(), timeout]);
    const s = state == null ? null : String(state);
    return s === 'CONNECTED'
      ? { ok: true, state: s, ms: Date.now() - started }
      : { ok: false, state: s, ms: Date.now() - started, reason: `state ${s}` };
  } catch (err) {
    return { ok: false, state: null, ms: Date.now() - started, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
