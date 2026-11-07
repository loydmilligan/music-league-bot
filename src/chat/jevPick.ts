export interface JevPickState {
  chat: string;
  speaker: string;
  request: string;
  recent_messages: Array<{ sender: string; text: string }>;
}

export interface JevPicker {
  pick(instructions: string, options: string[], state: JevPickState): Promise<{ choice: string | null; cost: number }>;
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
    async pick(instructions, options, state) {
      // One try; the caller's fallback is the retry.
      const response = await fetchImpl(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: o.model ?? 'typesafe/jev-1.13',
          state,
          questions: { pick: { type: 'choice', instructions, criteria: options } },
        }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 6000),
      });
      if (!response.ok) throw new Error(`Jev pick ${response.status}`);
      const result = (await response.json()) as JevPickResponse;
      const cost = typeof result.usage?.cost === 'number' ? result.usage.cost : 0;
      if (typeof result.usage?.cost === 'number') console.log(`[jev-pick] cost=${cost}`);
      const choice = result.answers?.pick?.choice;
      return { choice: typeof choice === 'string' && options.includes(choice) ? choice : null, cost };
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
