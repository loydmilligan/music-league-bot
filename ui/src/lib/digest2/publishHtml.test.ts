import { describe, it, expect } from 'vitest';
import { transformDigest2Html, findLeaks } from './publishHtml.js';

const HOSTS = ['mlb13.example.com', 'localhost:3002'];
const clean = '<html><head></head><body><a href="https://open.spotify.com/x">s</a><script src="./_app/a.js"></script></body></html>';

describe('transformDigest2Html', () => {
	it('rewrites ../_app/ and /_app/ to ./_app/', () => {
		const out = transformDigest2Html('<head></head><script src="../_app/x.js"></script><link href="/_app/y.css">', { hasLocalFonts: false });
		expect(out).toContain('src="./_app/x.js"');
		expect(out).toContain('href="./_app/y.css"');
		expect(out).not.toMatch(/"\/_app\//);
	});
	it('drops icon / apple-touch-icon / manifest links', () => {
		const out = transformDigest2Html('<head><link rel="icon" href="/f.png"><link rel="manifest" href="/m.webmanifest"></head>', { hasLocalFonts: false });
		expect(out).not.toContain('rel="icon"');
		expect(out).not.toContain('rel="manifest"');
	});
	it('swaps Google Fonts for the local stylesheet when localized', () => {
		const out = transformDigest2Html('<head><link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet"></head>', { hasLocalFonts: true });
		expect(out).not.toContain('fonts.googleapis.com');
		expect(out).toContain('href="./_app/fonts.css"');
	});
	it('injects the /api/ml-auth fetch guard', () => {
		expect(transformDigest2Html('<head></head>', { hasLocalFonts: false })).toContain('/api/ml-auth');
	});
});

describe('findLeaks', () => {
	it('clean page → no leaks', () => {
		expect(findLeaks({ html: clean, textAssets: new Map([['/_app/a.js', 'console.log(1)']]), forbiddenHosts: HOSTS })).toEqual([]);
	});
	it('admin host anywhere in the HTML → leak', () => {
		const html = clean.replace('</body>', '<script>{"u":"https://mlb13.example.com/digest/1"}</script></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('admin host inside a captured JS chunk → leak naming the file', () => {
		const leaks = findLeaks({ html: clean, textAssets: new Map([['/_app/b.js', 'fetch("https://mlb13.example.com/api")']]), forbiddenHosts: HOSTS });
		expect(leaks.join('\n')).toContain('/_app/b.js');
	});
	it('internal origin (localhost:3002) → leak', () => {
		const html = clean.replace('</body>', '<img src="http://localhost:3002/x.png"></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('root-relative app link (href, action, src, poster) → leak', () => {
		for (const attr of ['href="/stats"', 'action="/digest2/1/stats"', 'src="/share/x.jpg"', 'poster="/p.jpg"']) {
			const html = clean.replace('</body>', `<a ${attr}>x</a></body>`);
			expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }), attr).not.toEqual([]);
		}
	});
	it('protocol-relative and ./ relative links are fine', () => {
		const html = clean.replace('</body>', '<a href="./_app/x">a</a><img src="//i.scdn.co/x.jpg"></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS })).toEqual([]);
	});
});
