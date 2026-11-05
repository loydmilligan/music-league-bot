// Pure HTML rules for the static 2.0 share artifact (forked from 1.0's
// transformShareHtml in lib/digest/export.ts — that file is not edited).

const FETCH_GUARD =
	`<script>(function(){var f=window.fetch;window.fetch=function(u){try{` +
	`var s=typeof u==="string"?u:(u&&u.url)||"";` +
	`if(s.indexOf("/api/ml-auth")!==-1)return Promise.resolve(new Response(null,{status:204}));` +
	`}catch(e){}return f.apply(this,arguments);};})();</script>`;

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const EXPORT_HIDE_OPEN = /<([a-zA-Z][\w-]*)\b[^>]*\bdata-export-hide\s*=\s*["']?1["']?[^>]*>/;

/**
 * Drop every `[data-export-hide="1"]` element (with its contents): operator-only chrome such as the
 * podium's Cover Factory notes and links. 1.0 exports only hide these with CSS; the static share must
 * not carry them at all (their app links would also trip the root-relative leak gate).
 */
export function stripExportHidden(html: string): string {
	let h = html;
	for (let m = EXPORT_HIDE_OPEN.exec(h); m; m = EXPORT_HIDE_OPEN.exec(h)) {
		const start = m.index;
		const openEnd = start + m[0].length;
		const tag = m[1].toLowerCase();
		let end = openEnd;
		if (!m[0].endsWith('/>') && !VOID_TAGS.has(tag)) {
			const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
			re.lastIndex = openEnd;
			let depth = 1;
			for (let t = re.exec(h); t; t = re.exec(h)) {
				if (t[1]) depth--;
				else if (!t[0].endsWith('/>')) depth++;
				if (depth === 0) {
					end = t.index + t[0].length;
					break;
				}
			}
		}
		h = h.slice(0, start) + h.slice(end);
	}
	return h;
}

/** Rewrite a captured SSR document so it works from digests/d2/<slug>/ on a dumb static host. */
export function transformDigest2Html(html: string, opts: { hasLocalFonts: boolean }): string {
	let h = stripExportHidden(html);
	// ./ prefix is mandatory — a bare "_app/…" specifier is illegal for dynamic import().
	h = h.replaceAll('../_app/', './_app/').replaceAll('"/_app/', '"./_app/');
	h = h.replace(/[ \t]*<link\b[^>]*\brel="(?:icon|apple-touch-icon|manifest)"[^>]*>\n?/g, '');
	h = h.replace(/[ \t]*<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\n?/g, '');
	if (opts.hasLocalFonts) {
		h = h.replace('</head>', '\t\t<link rel="stylesheet" href="./_app/fonts.css" />\n\t</head>');
	}
	h = h.replace('<head>', '<head>\n\t\t' + FETCH_GUARD);
	return h;
}

// Match root-relative paths in attributes: handles double/single quotes, no quotes, uppercase, spaces around =
const ROOT_RELATIVE_ATTR = /\b(href|src|action|poster|srcset|formaction)\s*=\s*["']?\/(?!\/)[^"'\s>]*/gi;
// Match root-relative paths in url() CSS functions: handles quotes or no quotes, but not protocol-relative //
const ROOT_RELATIVE_URL = /url\s*\(\s*["']?\/(?!\/)[^)'"]*["']?\s*\)/gi;

function snippet(text: string, at: number): string {
	return text.slice(Math.max(0, at - 60), at + 80).replace(/\s+/g, ' ');
}

/**
 * Hard gate before anything is written: the published copy must not mention the
 * admin/internal hosts anywhere, and its HTML must not link root-relative (those
 * resolve to digest.mattmariani.com/<app route> → 404, or worse, an app path).
 */
export function findLeaks(input: {
	html: string;
	textAssets: Map<string, string>;
	forbiddenHosts: string[];
}): string[] {
	const leaks: string[] = [];
	const sources: [string, string][] = [['index.html', input.html], ...input.textAssets];
	const forbiddenHostsLower = input.forbiddenHosts.map((h) => h.toLowerCase());
	for (const [name, text] of sources) {
		for (const host of forbiddenHostsLower) {
			const at = text.toLowerCase().indexOf(host);
			if (at !== -1) leaks.push(`${name}: forbidden host "${host}" … ${snippet(text, at)}`);
		}
	}
	for (const m of input.html.matchAll(ROOT_RELATIVE_ATTR)) {
		leaks.push(`index.html: root-relative ${m[0]} … ${snippet(input.html, m.index ?? 0)}`);
	}
	for (const m of input.html.matchAll(ROOT_RELATIVE_URL)) {
		leaks.push(`index.html: root-relative ${m[0]} … ${snippet(input.html, m.index ?? 0)}`);
	}
	return leaks;
}

export function missingAppAssets(html: string, assets: Map<string, Buffer>): string[] {
	const missing = new Set<string>();
	for (const m of html.matchAll(/\.\/(_app\/[^"'\s)>?#]+)/g)) {
		if (m[1] !== '_app/fonts.css' && !assets.has('/' + m[1])) missing.add(m[1]);
	}
	return [...missing];
}
