import { describe, it, expect, vi } from 'vitest';
import { runDigestTick, type AutoPostDeps, type ScheduleEntry } from '../src/digest/autoPost.js';

const STAGING = '120363406254406895@g.us';
const URL = 'https://digest.mattmariani.com/d/abc123';

const sendEntry: ScheduleEntry = {
  leagueId: 1,
  leagueSlug: 'fam-jam',
  action: 'send',
  roundId: 123,
  roundName: 'Wild Thing',
  reason: 'voting closed',
};

function deps(over: Partial<AutoPostDeps> = {}): AutoPostDeps {
  return {
    env: { mode: 'live', targets: { 'fam-jam': STAGING } },
    fetchSchedule: vi.fn().mockResolvedValue([sendEntry]),
    claimAndExport: vi.fn().mockResolvedValue({ claimed: true, url: URL }),
    send: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...over,
  };
}

describe('decisions that are not sends', () => {
  it('does nothing for a hold', async () => {
    const d = deps({
      fetchSchedule: vi.fn().mockResolvedValue([
        { ...sendEntry, action: 'hold', reason: 'season-final round' },
      ]),
    });
    await runDigestTick(d);

    expect(d.claimAndExport).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing to do', async () => {
    const d = deps({ fetchSchedule: vi.fn().mockResolvedValue([{ ...sendEntry, action: 'none' }]) });
    await runDigestTick(d);

    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('the guard is consulted before anything is claimed', () => {
  it('does not claim in dry-run — a dry run must not burn the round\'s claim', async () => {
    const d = deps({ env: { mode: 'dry-run', targets: { 'fam-jam': STAGING } } });
    await runDigestTick(d);

    expect(d.claimAndExport).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('does not claim for a league with no configured target', async () => {
    const d = deps({ env: { mode: 'live', targets: {} } });
    await runDigestTick(d);

    expect(d.claimAndExport).not.toHaveBeenCalled();
  });

  it('logs what a dry run would have sent', async () => {
    const log = vi.fn();
    await runDigestTick(deps({ env: { mode: 'dry-run', targets: { 'fam-jam': STAGING } }, log }));

    expect(log.mock.calls.flat().join('\n')).toMatch(/fam-jam/);
  });
});

describe('the happy path', () => {
  it('claims, sends the url, then confirms', async () => {
    const d = deps();
    await runDigestTick(d);

    expect(d.claimAndExport).toHaveBeenCalledWith(123);
    expect(d.send).toHaveBeenCalledWith(STAGING, expect.stringContaining(URL));
    expect(d.confirm).toHaveBeenCalledWith(123, STAGING, URL);
  });

  it('includes the round name in the message', async () => {
    const d = deps();
    await runDigestTick(d);

    expect(d.send).toHaveBeenCalledWith(STAGING, expect.stringContaining('Wild Thing'));
  });
});

describe('claim failures', () => {
  it('does not send when the round is already claimed', async () => {
    const d = deps({ claimAndExport: vi.fn().mockResolvedValue({ claimed: false }) });
    await runDigestTick(d);

    expect(d.send).not.toHaveBeenCalled();
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('does not send when the export produced no url', async () => {
    const d = deps({ claimAndExport: vi.fn().mockResolvedValue({ claimed: true }) });
    await runDigestTick(d);

    expect(d.send).not.toHaveBeenCalled();
  });
});

describe('send failures', () => {
  it('records the failure and does not confirm', async () => {
    const d = deps({ send: vi.fn().mockRejectedValue(new Error('sendMessage timed out')) });
    await runDigestTick(d);

    expect(d.fail).toHaveBeenCalledWith(123, expect.stringContaining('timed out'));
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('keeps going when one league fails', async () => {
    const second: ScheduleEntry = { ...sendEntry, leagueSlug: 'hip-jammers', roundId: 200 };
    const d = deps({
      env: { mode: 'live', targets: { 'fam-jam': STAGING, 'hip-jammers': STAGING } },
      fetchSchedule: vi.fn().mockResolvedValue([sendEntry, second]),
      send: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined),
    });
    await runDigestTick(d);

    expect(d.confirm).toHaveBeenCalledWith(200, STAGING, URL);
  });
});

describe('the tick never throws', () => {
  it('swallows a schedule fetch failure so the poller survives', async () => {
    const d = deps({ fetchSchedule: vi.fn().mockRejectedValue(new Error('bot-ui is down')) });

    await expect(runDigestTick(d)).resolves.toBeUndefined();
    expect(d.log).toHaveBeenCalled();
  });
});
