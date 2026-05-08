// Sequential promise queue — each call waits for the previous to finish,
// then enforces a minimum interval. Keeps Songlink API usage under 10/min.
class RateLimiter {
  private lastCallTime = 0;
  private readonly minIntervalMs: number;
  private pending: Promise<void> = Promise.resolve();

  constructor(callsPerMinute: number) {
    this.minIntervalMs = Math.ceil(60_000 / callsPerMinute);
  }

  acquire(): Promise<void> {
    this.pending = this.pending.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastCallTime);
      if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
      this.lastCallTime = Date.now();
    });
    return this.pending;
  }
}

export const songlinkLimiter = new RateLimiter(10);
