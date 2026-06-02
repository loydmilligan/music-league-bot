// Shared rate limiter for synchronous, on-click Songlink/Odesli calls made from
// the SvelteKit server (the `/api/ytm/[spotifyUri]` and `/api/spotify-from-ytm`
// resolve endpoints). Mirrors `src/resolver/songlinkRateLimiter.ts` — the bot
// process can't be imported here because `src/` is outside the ui Docker build
// context (`Dockerfile.ui` only copies `ui/`), so this is the ui-side instance
// of the same throttle, keeping Songlink usage under 10/min.
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
