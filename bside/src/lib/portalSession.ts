import { getContext, setContext } from 'svelte';
import type { AuthMe, Hub, SurveyApi } from './surveyApi.js';

export interface PortalSession {
	me: AuthMe | null;
	hub: Hub | null;
	admin: boolean;
	api: SurveyApi | null;
	refresh: () => Promise<void>;
}

const KEY = Symbol('portal-session');

export function setPortalSession(session: PortalSession): void {
	setContext(KEY, session);
}

export function getPortalSession(): PortalSession {
	return getContext(KEY) ?? { me: null, hub: null, admin: false, api: null, refresh: async () => {} };
}
