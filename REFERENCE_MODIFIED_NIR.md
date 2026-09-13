# Reference: Modified NIR Repository

This document marks the legacy/modified repository used only as a comparison reference for NIR V2.

## Source repository

- Repository: `https://github.com/hassana7898/nir`
- Branch: `main`

## Rules for AI Studio / NIR V2

This repository is **NOT** the source of truth for NIR V2.

The NIR V2 project (`hassana7898/Nir-V2`) is the primary working project.
The modified repository is a reference specimen used to:

- compare features and workflows
- identify useful changes
- identify regressions and bugs
- recover missing functionality
- compare architecture and persistence behavior

For every difference, classify it as:

- **KEEP** — correct and safe to preserve
- **ADAPT** — useful idea, but implementation must be redesigned/fixed before adoption
- **REJECT** — buggy, unsafe, redundant, or architecturally unsound

Never blindly copy code from the reference repository.
Never treat a newer implementation as automatically correct.
Never overwrite NIR V2 merely to make it resemble the reference repository.

## Important investigation areas

Pay particular attention to:

- authentication and session handling
- حواله creation/update/delete
- persistence and database transactions
- inventory changes caused by حواله
- backup/export/import completeness
- IndexedDB/localStorage state
- Service Worker caching
- offline queue and synchronization
- stale data overwriting authoritative data
- duplicate mutations and idempotency
- API error handling and timeouts
- UI behavior after save/refresh/reload

The objective is to preserve correct business behavior while selectively recovering useful improvements without importing regressions.
