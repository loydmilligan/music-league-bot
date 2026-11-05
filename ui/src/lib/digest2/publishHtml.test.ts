import { describe, it, expect } from 'vitest';
import { transformDigest2Html, findLeaks, stripExportHidden } from './publishHtml.js';

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
	it('removes [data-export-hide="1"] elements (operator-only chrome) with their contents', () => {
		const html =
			'<head></head><body><div class="apod"><p class="apod-cf" data-export-hide="1">note <a href="/cover-factory?project=7">Open</a> <span><b>x</b></span></p>' +
			"<span data-export-hide='1'><span>inner</span></span><img data-export-hide=\"1\" src=\"/x.png\"><br data-export-hide=\"1\" />" +
			'<p class="keep">kept <span>this</span></p></div></body>';
		const out = transformDigest2Html(html, { hasLocalFonts: false });
		expect(out).not.toMatch(/data-export-hide|cover-factory|note|inner|x\.png/);
		expect(out).toContain('<div class="apod"><p class="keep">kept <span>this</span></p></div>');
		expect(findLeaks({ html: out, textAssets: new Map(), forbiddenHosts: HOSTS })).toEqual([]);
	});
	it('an export-hidden element without its close tag fails closed (throws), never publishes the rest', () => {
		const html = '<head></head><body><div data-export-hide="1"><a href="/cover-factory?project=7">x</a></body>';
		expect(() => transformDigest2Html(html, { hasLocalFonts: false })).toThrow(/data-export-hide.*<div> has no closing tag/);
	});
	it('matches only the exact value 1 (quoted or bare), not 10 / "1x" / data-export-hide-x', () => {
		for (const keep of ['<p data-export-hide="10">k</p>', "<p data-export-hide='1x'>k</p>", '<p data-export-hide=12>k</p>', '<p data-export-hide-x="1">k</p>']) {
			expect(stripExportHidden(keep), keep).toBe(keep);
		}
		for (const drop of ['<p data-export-hide="1">d</p>', "<p data-export-hide='1'>d</p>", '<p data-export-hide=1>d</p>', '<p data-export-hide = "1" class="x">d</p>']) {
			expect(stripExportHidden(`a${drop}b`), drop).toBe('ab');
		}
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
	it('root-relative with single quotes → leak', () => {
		const html = clean.replace('</body>', "<a href='/stats'>x</a></body>");
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('root-relative with uppercase attrs → leak', () => {
		const html = clean.replace('</body>', '<a HREF="/stats">x</a></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('root-relative with spaces around = → leak', () => {
		const html = clean.replace('</body>', '<a href = "/stats">x</a></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('root-relative srcset → leak', () => {
		const html = clean.replace('</body>', '<img srcset="/a.jpg 1x, /b.jpg 2x">x</img></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('root-relative formaction → leak', () => {
		const html = clean.replace('</body>', '<button formaction="/x">x</button></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('root-relative in url() style → leak', () => {
		const html = clean.replace('</body>', '<div style="background:url(/share/x.jpg)">x</div></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('root-relative in url() with quotes → leak', () => {
		const html = clean.replace('</body>', "<div style=\"background:url('/x.jpg')\">x</div></body>");
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('case-insensitive forbidden host → leak', () => {
		const html = clean.replace('</body>', '<script>{"u":"https://MLB13.example.com/digest/1"}</script></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS }).length).toBeGreaterThan(0);
	});
	it('protocol-relative and ./ relative links are fine', () => {
		const html = clean.replace('</body>',
			'<a href="./_app/x">a</a><img src="//i.scdn.co/x.jpg"><img srcset="//cdn/x.jpg 1x"><div style="background:url(//cdn/x.jpg)"></div></body>');
		expect(findLeaks({ html, textAssets: new Map(), forbiddenHosts: HOSTS })).toEqual([]);
	});
});

import { missingAppAssets } from './publishHtml.js';
describe('missingAppAssets', () => {
	const html = '<script src="./_app/a.js"></script><link href="./_app/b.css"><link href="./_app/fonts.css">import("./_app/c.js?v=1")';
	it('lists referenced assets that were not captured', () => {
		const assets = new Map([['/_app/a.js', Buffer.from('')]]);
		expect(missingAppAssets(html, assets).sort()).toEqual(['_app/b.css', '_app/c.js']);
	});
	it('ignores fonts.css and returns [] when all present', () => {
		const assets = new Map(['/_app/a.js', '/_app/b.css', '/_app/c.js'].map((k) => [k, Buffer.from('')] as [string, Buffer]));
		expect(missingAppAssets(html, assets)).toEqual([]);
	});
});
