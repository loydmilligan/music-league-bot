export interface JevPickState {
  chat: string;
  speaker: string;
  request: string;
  recent_messages: Array<{ sender: string; text: string }>;
}

export interface JevPicker {
  pick(
    instructions: string,
    options: string[],
    state: JevPickState,
    descriptions?: Record<string, string>,
  ): Promise<{ choice: string | null; cost: number }>;
}

/** Non-OK response from the decisions endpoint. Carries only the status, never the body. */
export class JevPickHttpError extends Error {
  constructor(readonly status: number) {
    super(`Jev pick ${status}`);
    this.name = 'JevPickHttpError';
  }
}

interface JevPickResponse {
  answers?: Record<string, { choice?: unknown; probabilities?: unknown }>;
  usage?: { cost?: number };
}

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';

export function createJevPicker(o: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): JevPicker {
  const fetchImpl = o.fetchImpl ?? fetch;
  return {
    async pick(instructions, options, state, descriptions) {
      // One try; the caller's fallback is the retry.
      const response = await fetchImpl(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: o.model ?? 'typesafe/jev-1.13',
          state,
          questions: { pick: { type: 'choice', instructions, criteria: Object.fromEntries(options.map((x) => [x, descriptions?.[x] ?? x])) } },
        }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 6000),
      });
      if (!response.ok) throw new JevPickHttpError(response.status);
      const result = (await response.json()) as JevPickResponse;
      const cost = typeof result.usage?.cost === 'number' ? result.usage.cost : 0;
      if (typeof result.usage?.cost === 'number') console.log(`[jev-pick] cost=${cost}`);
      const choice = result.answers?.pick?.choice;
      const strip = (e: string) => e.replace(/\uFE0F/g, '');
      const matched = typeof choice === 'string' ? options.find((x) => strip(x) === strip(choice)) : undefined;
      return { choice: matched ?? null, cost };
    },
  };
}

export function jevPickState(o: {
  chatName: string;
  speaker: string;
  body: string;
  priorMessages: Array<{ sender: string; text: string }>;
}): JevPickState {
  return {
    chat: o.chatName,
    speaker: o.speaker,
    request: o.body.replace(/^\s*@\S+\s*/u, '').trim().slice(0, 800),
    recent_messages: o.priorMessages.slice(-8).map((m) => ({ sender: m.sender, text: m.text.slice(0, 500) })),
  };
}
