export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const KEY = (id: string): string => `tw-panel:${id}`;

function resolve(storage?: StorageLike): StorageLike | null {
	if (storage) return storage;
	if (typeof localStorage !== 'undefined') return localStorage;
	return null;
}

export function loadPanelOpen(id: string, defaultOpen = false, storage?: StorageLike): boolean {
	const s = resolve(storage);
	if (!s) return defaultOpen;
	const v = s.getItem(KEY(id));
	return v === null ? defaultOpen : v === '1';
}

export function savePanelOpen(id: string, open: boolean, storage?: StorageLike): void {
	const s = resolve(storage);
	if (!s) return;
	s.setItem(KEY(id), open ? '1' : '0');
}
