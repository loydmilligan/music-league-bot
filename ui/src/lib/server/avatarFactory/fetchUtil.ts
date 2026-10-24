import type { FetchLike } from './openrouter.js';

/** Skip sleeps when tests inject fetchImpl so mocks never wait on the network. */
export function pollIntervalMs(fetchImpl?: FetchLike): number {
	return fetchImpl ? 0 : 1500;
}

export async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return;
	await new Promise((r) => setTimeout(r, ms));
}

export function redact(text: string, key: string): string {
	if (!key) return text;
	return text.split(key).join('[redacted]');
}

export async function bytesFromImageRef(raw: string, fetchImpl: FetchLike): Promise<Uint8Array> {
	if (raw.startsWith('data:')) {
		const b64Match = raw.match(/^data:[^;]+;base64,(.+)$/);
		if (!b64Match) throw new Error('malformed data URI');
		return new Uint8Array(Buffer.from(b64Match[1], 'base64'));
	}
	const imgRes = await fetchImpl(raw);
	if (!imgRes.ok) throw new Error(`Failed to fetch image from URL: ${imgRes.status}`);
	return new Uint8Array(await imgRes.arrayBuffer());
}
