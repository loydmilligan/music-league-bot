export interface JevChatRequest {
  chatId: string;
  chatName: string;
  authorId: string;
  authorName?: string;
  prompt: string;
  priorMessages: Array<{ sender: string; timeMs: number; text: string }>;
}

interface JevAnswer {
  noul?: number;
  score?: number;
}

interface JevResponse {
  answers?: Record<string, JevAnswer>;
  usage?: { cost?: number };
  model?: string;
}

export interface JevResponderOptions {
  apiKey: string;
  model?: string;
  cooldownMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';

export function extractJevPrompt(body: string, mentionsBot = false): string | null {
  const command = body.match(/^\s*!jev(?:\s+|$)([\s\S]*)/i);
  if (command) return command[1].trim() || 'Read the current chat vibe.';
  if (!mentionsBot) return null;
  // WhatsApp gives us the mentioned account id separately, but not the text
  // span occupied by the display name. Remove the first @token; any remaining
  // display-name words are harmless context for Jev.
  return body.replace(/^\s*@\S+\s*/u, '').trim() || 'Read the current chat vibe.';
}

function score(answers: Record<string, JevAnswer>, key: string): number {
  const value = answers[key]?.score;
  return typeof value === 'number' ? Math.max(0, Math.min(3, Math.round(value))) : 0;
}

function yes(answers: Record<string, JevAnswer>, key: string): boolean {
  return (answers[key]?.noul ?? 0) >= 0.6;
}

function describe(answers: Record<string, JevAnswer>): string {
  const heat = score(answers, 'heat');
  const chaos = score(answers, 'chaos');
  const warmth = score(answers, 'affection');
  const pull = score(answers, 'conversation_pull');
  const tags = [
    yes(answers, 'is_music') ? 'music-brained' : null,
    yes(answers, 'is_banter') ? 'banter-forward' : null,
    yes(answers, 'is_logistics') ? 'commissioner-coded' : null,
  ].filter(Boolean);

  let verdict = 'calm but potentially combustible';
  if (chaos >= 3) verdict = 'fully unhinged, in the affectionate sense';
  else if (heat >= 2 && warmth >= 2) verdict = 'a friendly knife fight';
  else if (heat >= 2) verdict = 'running a little hot';
  else if (warmth >= 3) verdict = 'disgustingly wholesome';
  else if (pull >= 3) verdict = 'engineered to start a thread';

  return `🧠 Jev read: ${verdict}. Heat ${heat}/3 · chaos ${chaos}/3 · warmth ${warmth}/3 · reply pull ${pull}/3${tags.length ? ` · ${tags.join(', ')}` : ''}.`;
}

export function createJevResponder(options: JevResponderOptions): (request: JevChatRequest) => Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? 30_000;
  const lastReplyByChat = new Map<string, number>();

  return async (request) => {
    const previous = lastReplyByChat.get(request.chatId) ?? 0;
    const remaining = cooldownMs - (now() - previous);
    if (remaining > 0) return `Jev is cooling down — try again in ${Math.ceil(remaining / 1000)}s.`;

    const context = request.priorMessages.slice(-8).map((message) => ({
      sender: message.sender,
      text: message.text.slice(0, 500),
    }));
    const response = await fetchImpl(JEV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model ?? 'typesafe/jev-1.13',
        state: {
          chat: request.chatName,
          speaker: request.authorName ?? request.authorId,
          request: request.prompt.slice(0, 800),
          recent_messages: context,
        },
        questions: {
          heat: { type: 'score', instructions: 'How heated is this chat moment?', criteria: ['chill', 'playful', 'heated', 'full roast'] },
          chaos: { type: 'score', instructions: 'How chaotic or unhinged is the energy?', criteria: ['composed', 'loose', 'chaotic', 'unhinged'] },
          affection: { type: 'score', instructions: 'How affectionate is the tone?', criteria: ['hostile', 'sharp', 'neutral', 'affectionate'] },
          conversation_pull: { type: 'score', instructions: 'How strongly does this invite replies?', criteria: ['thread killer', 'weak pull', 'invites replies', 'must reply'] },
          is_music: { type: 'noul', instructions: 'Is this mainly about music or Music League?' },
          is_banter: { type: 'noul', instructions: 'Is this friendly group banter?' },
          is_logistics: { type: 'noul', instructions: 'Is this mainly league coordination or housekeeping?' },
        },
      }),
    });
    if (!response.ok) throw new Error(`Jev ${response.status}: ${(await response.text()).slice(0, 160)}`);

    const result = await response.json() as JevResponse;
    lastReplyByChat.set(request.chatId, now());
    console.log(`[jev-chat] ${request.chatName} model=${result.model ?? options.model ?? 'typesafe/jev-1.13'} cost=${result.usage?.cost ?? 0}`);
    return describe(result.answers ?? {});
  };
}
