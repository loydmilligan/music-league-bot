import { toPng } from 'html-to-image';

export async function shareCardImage(node: HTMLElement, filename: string): Promise<void> {
	const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: '#0d1116' });
	const res = await fetch(dataUrl);
	const blob = await res.blob();
	const file = new File([blob], filename, { type: 'image/png' });
	const nav = navigator as Navigator & {
		canShare?: (data: { files: File[] }) => boolean;
		share?: (data: { files: File[]; title?: string }) => Promise<void>;
	};
	if (nav.canShare?.({ files: [file] })) {
		try {
			await nav.share({ files: [file] });
			return;
		} catch {
			/* fall through to download */
		}
	}
	const a = document.createElement('a');
	a.href = dataUrl;
	a.download = filename;
	a.click();
}
