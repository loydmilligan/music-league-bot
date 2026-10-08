import type { Nav } from './types.js';

export type PortalRoute =
	| { screen: 'home' }
	| { screen: 'profile'; memberId: string }
	| { screen: 'archive' }
	| { screen: 'season' }
	| { screen: 'login' }
	| { screen: 'logout' }
	| { screen: 'settings' }
	| { screen: 'admin' }
	| { screen: 'survey' }
	| { screen: 'mine' };

export function parseRoute(pathname: string, slug: string): PortalRoute {
	const rest = pathname.startsWith(`/${slug}`)
		? pathname.slice(`/${slug}`.length) || '/'
		: pathname;
	const clean = (rest.replace(/\/+$/, '') || '/') as string;
	if (clean.startsWith('/p/')) {
		return { screen: 'profile', memberId: clean.slice(3).split('/')[0] || '' };
	}
	switch (clean) {
		case '/archive': return { screen: 'archive' };
		case '/season': return { screen: 'season' };
		case '/login': return { screen: 'login' };
		case '/logout': return { screen: 'logout' };
		case '/settings': return { screen: 'settings' };
		case '/admin': return { screen: 'admin' };
		case '/survey': return { screen: 'survey' };
		case '/mine': return { screen: 'mine' };
		default: return { screen: 'home' };
	}
}

export function pathFor(slug: string, route: PortalRoute): string {
	const root = `/${slug}`;
	switch (route.screen) {
		case 'home': return root;
		case 'profile': return `${root}/p/${route.memberId}`;
		case 'archive': return `${root}/archive`;
		case 'season': return `${root}/season`;
		case 'login': return `${root}/login`;
		case 'logout': return `${root}/logout`;
		case 'settings': return `${root}/settings`;
		case 'admin': return `${root}/admin`;
		case 'survey': return `${root}/survey`;
		case 'mine': return `${root}/mine`;
	}
}

export function navFor(slug: string, push: (path: string, route: PortalRoute) => void, openShare: Nav['openShare']): Nav {
	return {
		goHome: () => push(pathFor(slug, { screen: 'home' }), { screen: 'home' }),
		goArchive: () => push(pathFor(slug, { screen: 'archive' }), { screen: 'archive' }),
		goSeason: () => push(pathFor(slug, { screen: 'season' }), { screen: 'season' }),
		goProfile: (id) => push(pathFor(slug, { screen: 'profile', memberId: id }), { screen: 'profile', memberId: id }),
		goLogin: () => push(pathFor(slug, { screen: 'login' }), { screen: 'login' }),
		goLogout: () => push(pathFor(slug, { screen: 'logout' }), { screen: 'logout' }),
		goSettings: () => push(pathFor(slug, { screen: 'settings' }), { screen: 'settings' }),
		goAdmin: () => push(pathFor(slug, { screen: 'admin' }), { screen: 'admin' }),
		goSurvey: () => push(pathFor(slug, { screen: 'survey' }), { screen: 'survey' }),
		goMine: () => push(pathFor(slug, { screen: 'mine' }), { screen: 'mine' }),
		openShare,
	};
}
