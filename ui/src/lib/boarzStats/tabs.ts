export const STATS_TABS = [
	{ id: 'leaderboard', label: '🏆 Standings & Scores', title: 'Standings, cumulative race, points by round, and round winners', seasonOnly: true },
	{ id: 'songs', label: '🎵 Songs', title: 'Song performance and submission details' },
	{ id: 'artists', label: '🎤 Artists', title: 'Artist performance across submissions' },
	{ id: 'heatmap', label: '🔥 Vote Heatmap', title: 'How players voted for one another' },
	{ id: 'votesgiven', label: '💙 Votes Given', title: 'Voting patterns by player' },
	{ id: 'playlist', label: '📍 Playlist Position', title: 'How playlist order relates to results' },
	{ id: 'chat', label: '💬 Chat', title: 'League chat activity', needsChat: true },
	{ id: 'fun', label: '✨ Fun Stats', title: 'Additional league superlatives' },
	{ id: 'wrapped', label: '🎈 Wrapped', title: 'Season highlights', seasonOnly: true },
] as const;
export type StatsTabId = (typeof STATS_TABS)[number]['id'];
