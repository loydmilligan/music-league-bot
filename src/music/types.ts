export interface ResolvedTrack {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  spotifyTrackId?: string;
  spotifyUri?: string;
  youtubeVideoId?: string;
  sourceUrl?: string;
  confidence: number;
}

export interface ISpotifyAdapter {
  searchTrack(query: string): Promise<ResolvedTrack | null>;
  getTrackById(spotifyTrackId: string): Promise<ResolvedTrack | null>;
  findOrCreatePlaylist(name: string): Promise<string>;
  addTrackToPlaylist(playlistId: string, spotifyUri: string): Promise<void>;
  isTrackInPlaylist(playlistId: string, spotifyUri: string): Promise<boolean>;
}

export interface IYouTubeAdapter {
  searchVideo(query: string): Promise<{ videoId: string; title: string } | null>;
  findOrCreatePlaylist(name: string): Promise<string>;
  addVideoToPlaylist(playlistId: string, videoId: string): Promise<void>;
  isVideoInPlaylist(playlistId: string, videoId: string): Promise<boolean>;
}
