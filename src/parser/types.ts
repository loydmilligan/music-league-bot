export interface ParsedSubmission {
  command: string;
  rawText: string;
  sourceUrl: string | null;
  artistHint: string | null;
  titleHint: string | null;
  tags: string[];
}
