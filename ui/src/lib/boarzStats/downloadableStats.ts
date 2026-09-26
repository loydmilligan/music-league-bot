import { toPng } from 'html-to-image';

function slugify(value: string): string {
	return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stat';
}

function download(dataUrl: string, filename: string): void {
	const link = document.createElement('a');
	link.download = filename;
	link.href = dataUrl;
	link.click();
}

/** Decorates every visible stat section with a two-click PNG export control. */
export function downloadableStats(node: HTMLElement, options: { prefix: string }) {
	let prefix = options.prefix;
	let observer: MutationObserver | null = null;

	const decorate = () => {
		const cards = [...node.querySelectorAll<HTMLElement>('section')]
			.filter((card) => !card.closest('section section'));
		cards.forEach((card, index) => {
			if (card.dataset.statCard) return;
			const title = card.querySelector('h2')?.textContent?.trim() || `visual-${index + 1}`;
			const cardId = slugify(title);
			card.dataset.statCard = cardId;
			card.style.position ||= 'relative';

			const button = document.createElement('button');
			button.type = 'button';
			button.dataset.noshot = '1';
			button.dataset.statsDownload = '1';
			button.title = `Download ${title} as PNG`;
			button.setAttribute('aria-label', `Download ${title} as PNG`);
			button.textContent = '↓ PNG';
			button.className = 'absolute right-3 top-3 z-20 rounded-md border border-border-muted bg-bg-elevated/95 px-2 py-1 font-mono text-[10px] font-semibold tracking-wide text-fg-muted shadow-sm transition hover:border-accent hover:text-accent';
			button.addEventListener('click', async () => {
				if (button.dataset.busy === '1') return;
				button.dataset.busy = '1';
				const prior = button.textContent;
				button.textContent = 'Rendering…';
				try {
					const dataUrl = await toPng(card, {
						pixelRatio: 2,
						cacheBust: true,
						skipFonts: true,
						backgroundColor: '#07090c',
						filter: (candidate) => !(candidate instanceof HTMLElement) || candidate.dataset.noshot !== '1',
					});
					download(dataUrl, `${slugify(prefix)}-${cardId}.png`);
					button.textContent = 'Saved ✓';
				} catch (error) {
					console.error('[stats] PNG export failed', error);
					button.textContent = 'PNG failed';
				} finally {
					delete button.dataset.busy;
					window.setTimeout(() => (button.textContent = prior), 1800);
				}
			});

			const linkButton = document.createElement('button');
			linkButton.type = 'button';
			linkButton.dataset.noshot = '1';
			linkButton.dataset.statsDownload = '1';
			linkButton.title = `Copy a link to ${title}`;
			linkButton.setAttribute('aria-label', `Copy a link to ${title}`);
			linkButton.textContent = '🔗';
			linkButton.className = 'absolute right-[4.5rem] top-3 z-20 rounded-md border border-border-muted bg-bg-elevated/95 px-2 py-1 font-mono text-[10px] text-fg-muted shadow-sm transition hover:border-accent hover:text-accent';
			linkButton.addEventListener('click', async () => {
				const url = new URL(window.location.href);
				url.searchParams.set('card', cardId);
				await navigator.clipboard.writeText(url.toString());
				linkButton.textContent = '✓';
				window.setTimeout(() => (linkButton.textContent = '🔗'), 1400);
			});

			card.append(linkButton, button);
			if (new URL(window.location.href).searchParams.get('card') === cardId) {
				card.style.outline = '2px solid var(--color-accent, #a78bfa)';
				card.style.outlineOffset = '3px';
				window.requestAnimationFrame(() => card.scrollIntoView({ block: 'center', behavior: 'smooth' }));
			}
		});
	};

	decorate();
	observer = new MutationObserver(decorate);
	observer.observe(node, { childList: true, subtree: true });

	return {
		update(next: { prefix: string }) {
			prefix = next.prefix;
			decorate();
		},
		destroy() {
			observer?.disconnect();
			node.querySelectorAll('[data-stats-download]').forEach((button) => button.remove());
		},
	};
}
