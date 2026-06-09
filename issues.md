---
id: monorepo-standardization
title: Monorepo Standardization
references:
  - sprint-19-deploy-and-mobile
status: open
summary: ui/ and root maintain separate package managers and dependencies. Migrate to PNPM Workspaces or Turborepo. Isolate the database schema into an internal package (@ml-bot/db) consumed independently by the bot and UI.
---
id: sqlite-concurrency
title: SQLite WAL Mode and Connection Pooling
references:
  - sprint-1
status: open
summary: Running the WhatsApp bot and SvelteKit UI against a single SQLite file risks SQLITE_BUSY lock errors. Configure WAL mode and synchronous=NORMAL. Migrate raw queries to a query builder with strict connection pooling.
---
id: scraping-session-resiliency
title: Scraping Resiliency and Session State
references:
  - sprint-12-remediation-ml-login-data-digest
status: open
summary: mlAuthHeartbeat and DOM scraping break on any class-name change. Implement MutationObservers in the extension, Zod validation for scraped payloads, and encrypted session token storage instead of flat files.
---
id: container-consolidation
title: Multi-Stage Container Consolidation
references:
  - sprint-19-deploy-and-mobile
status: open
summary: Dockerfile, Dockerfile.base, and Dockerfile.ui are fragmented. Consolidate into a single multi-stage Dockerfile — static UI assets compiled, node_modules pruned to prod-only, final image on distroless Node.
---
id: e2e-test-coverage
title: End-to-End Test Coverage
references:
  - sprint-11-export-import-and-rating-polish
status: open
summary: No automated verification that the UI or WhatsApp bridge works correctly. Add Playwright E2E tests for the SvelteKit UI and a mocked WhatsApp client interface for bot integration tests without requiring physical devices.
