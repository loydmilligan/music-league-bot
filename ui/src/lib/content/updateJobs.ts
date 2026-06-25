export interface UpdateJobResult {
	ok: boolean;
	slug: string;
	url: string;
	archivedRoundId: number;
	reshare: unknown;
}

export interface UpdateJob {
	status: 'running' | 'done' | 'error';
	result?: UpdateJobResult;
	error?: string;
}

export const updateJobs = new Map<string, UpdateJob>();
