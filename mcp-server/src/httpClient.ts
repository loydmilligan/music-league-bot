// Every MCP tool talks to the bot-ui app exclusively through this function —
// no tool file ever imports from ui/src/lib or opens the sqlite file
// directly (see the plan's Global Constraints).
export async function botUiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.BOT_UI_BASE_URL;
  if (!baseUrl) throw new Error('BOT_UI_BASE_URL is not configured (see .env.example)');
  const token = process.env.BOT_UI_API_TOKEN;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`bot-ui request failed: ${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
