# deploy/

Host-side **systemd user units**. Everything the project runs on a schedule lives
here — not in a container. The Docker services (`bot`, `api`, `bot-ui`,
`digest-static`) are in `docker-compose.yml`; see
[../docs/dev-loop-playbook.md](../docs/dev-loop-playbook.md).

These are user units, not system units: they run as the operator, use `%h` for the
home directory, and need a logged-in session (or lingering) to fire.

## Units

| Unit | Schedule | What it does |
|---|---|---|
| `mlb-auth-probe` | every 5 min | Music League auth heartbeat → `data/ml-auth.json` (`scripts/ml-auth-probe.mjs`). |
| `mlb-auth-trigger` | on demand | Host-side ML auth login (`scripts/ml-auth-trigger.mjs`). No timer — started by hand when auth expires. |
| `mlb-hil-ledes` | every 15 min | Round-end automation: generates story ledes for fresh HiL drafts and notifies (`scripts/digest-qa/hil_autorun.py`). **This is what owns round-end today.** |
| `mlb-ytm-drop` | every 15 min | On `voting_started`, mirrors the round's playlist into YouTube Music, generates the cover, and posts to the group (`scripts/ytm-drop/run.mjs`). Boarz-only scope; target from `.env` `YTM_DROP_TARGET`. |
| `mlb-rollout-host` | every 5 min | Rollout host executor for script + agent cuts (`scripts/rollout/host_executor.py --once`). **Installed but not enabled** — see below. |

## The rollout host is deliberately off

`mlb-rollout-host.timer` is `disabled`. The Rollout entity is built end to end but
has never run: `rollout_configs` and `rollout_runs` are both empty, and
`mlb-hil-ledes.timer` still owns round-end. Enabling this timer is a **cutover**,
not a deploy — follow the checklist in
[../docs/how-to/rollouts.md](../docs/how-to/rollouts.md) rather than just starting it.

## Install / update

```bash
cp deploy/*.service deploy/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now mlb-auth-probe.timer mlb-hil-ledes.timer mlb-ytm-drop.timer
```

Check what is actually running, and what it did:

```bash
systemctl --user list-timers --all | grep mlb
journalctl --user -u mlb-ytm-drop.service -n 50
```

A oneshot unit that fails leaves no timer trace — always read the journal, not the
timer list, when something did not happen.
