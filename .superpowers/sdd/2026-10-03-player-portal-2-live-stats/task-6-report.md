# Task 6 report
Files: ops/systemd/mlb-portal-stats.{service,timer}; Caddyfile.digest (@portalstats block before @league + header comment line).
caddy validate: Valid configuration.
Probe (throwaway p2-stats-probe, removed): stats/ 200; stats/_app/x.js 200; stats/s1/ 200; stats/.s1.old/index.html 404; league home 200; _bad/x 404; /api/p/x 502 (proxy to absent bot-ui, not served by file server).
Not done: install/deploy (controller).
