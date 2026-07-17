import { describe, it, expect, vi } from 'vitest';
import { runManualSend, type ManualSendDeps } from '../src/digest/manualSend.js';

const GROUP = '120363426590199032@g.us';

function deps(over: Partial<ManualSendDeps> = {}): ManualSendDeps {
  return {
    render: vi.fn().mockResolvedValue({ name: 'Unsung Heroes', url: 'https://d.mm.com/d/xyz' }),
    send: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...over,
  };
}

describe('dry-run', () => {
  it('renders and previews but sends nothing', async () => {
    const d = deps();
    const r = await runManualSend(d, { roundId: 132, target: GROUP, mode: 'dry-run' });

    expect(d.render).toHaveBeenCalledWith(132);
    expect(d.send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
    expect(r.preview).toContain('https://d.mm.com/d/xyz');
    expect(r.preview).toContain('Unsung Heroes');
  });
});

describe('live', () => {
  it('sends the digest to the target group', async () => {
    const d = deps();
    const r = await runManualSend(d, { roundId: 132, target: GROUP, mode: 'live' });

    expect(d.send).toHaveBeenCalledWith(GROUP, expect.stringContaining('https://d.mm.com/d/xyz'));
    expect(d.send).toHaveBeenCalledWith(GROUP, expect.stringContaining('Unsung Heroes'));
    expect(r.sent).toBe(true);
  });
});

describe('the guard still applies to a manual send', () => {
  it('refuses a non-@g.us target even in live mode', async () => {
    const d = deps();
    const r = await runManualSend(d, { roundId: 132, target: '36610938802265@lid', mode: 'live' });

    expect(d.send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
  });

  it('refuses an individual chat target', async () => {
    const d = deps();
    const r = await runManualSend(d, { roundId: 132, target: '16617476822@c.us', mode: 'live' });

    expect(d.send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
  });
});

describe('render failure', () => {
  it('does not send and reports the failure', async () => {
    const d = deps({ render: vi.fn().mockRejectedValue(new Error('no draft for this round')) });
    const r = await runManualSend(d, { roundId: 999, target: GROUP, mode: 'live' });

    expect(d.send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/no draft/);
  });
});
