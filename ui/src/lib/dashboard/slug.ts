import { randomBytes } from 'node:crypto';

// 16 bytes = 128 bits of entropy (≥80-bit requirement), URL-safe base64 (no padding).
export function mintSlug(): string {
	return randomBytes(16).toString('base64url');
}
