---
title: Safe Dismissal Click Gate
type: fix
date: 2026-06-06
flow:
  feature: safe-dismissal-clicks
  title: Safe Dismissal Click Gate
  phase: phase-1
  dependsOn: []
diagram: ../../flow/safe-dismissal-clicks.mmd
---

# Safe Dismissal Click Gate

## Overview

Add a conservative safety gate around YTBlocker's YouTube menu automation so extension-initiated clicks never navigate to a video. The extension should continue using DOM-only filtering where it already does so, and should only commit a real `Not interested` menu click when scoped validation proves the click belongs to the matched card and targets a non-navigation command.

This plan uses the 2026-06-06 brainstorm as source context and starts with phase `phase-1`: characterize the unsafe click surface and add harness coverage before refactoring the click flow.

## Problem Statement / Motivation

`content/content.js` currently has several safe DOM-only paths, but its budgeted dismissal flow still performs real YouTube UI clicks:

- `clickNotInterested()` finds a menu button within the target element, opens it, waits for any visible popup containing text that includes `not interested`, then clicks the returned target.
- `findNotInterestedItem()` searches visible popups globally and uses substring text matching.
- `getMenuItemClickTarget()` can return anchors or generic clickable descendants.
- Playlist and shelf flows reuse the same click function.

The user requirement is stronger: extension clicks should never go to a video. A false positive here is costly because a single wrong click can navigate the tab and interrupt the user. Therefore, unknown or ambiguous menu state must mean “do not click,” not “try anyway.”

## Proposed Solution

Implement a multi-stage safe dismissal gate around the existing menu automation:

1. Add low-risk observability and regression fixtures for unsafe menu/click cases.
2. Introduce validation helpers that prove page eligibility, card/menu-button scope, popup freshness/ownership, non-link menu item shape, exact normalized `Not interested` command text, and URL stability.
3. Route every budgeted menu action through the safe gate and provide conservative fallbacks for unsafe cases.
4. Verify with the existing scroll harness plus new navigation-safety scenarios.

The design intentionally keeps duration, age/created-time, and sponsored filters DOM-only. They already enqueue `remove`, so they should not start using YouTube menu clicks unless a future plan applies the same safe gate.

## Technical Considerations

- **Architecture impact**: Keep the work inside `content/content.js` and the existing queue/scroll-preservation model. Avoid adding background-script permissions or changing the Manifest V3 shape.
- **False-positive posture**: Fail closed. If validation cannot prove the target is safe, use a conservative fallback and log a structured reason.
- **Page context**: Watch pages remain hide-only. Feed/search can attempt safe dismissal; other pages should remain conservative.
- **Popup scoping**: Capture visible popup state before opening the menu, then only inspect a newly visible/changed popup that plausibly belongs to the clicked menu button.
- **Navigation guard**: Snapshot `location.href` before the committed click and watch for URL changes / `yt-navigate-start` during the click window. Any detected navigation should disable further menu automation for the page/session.
- **Tests/harness**: Extend `tools/scroll-harness.html` and `tools/run-scroll-harness.mjs` instead of introducing a new test framework.

## Acceptance Criteria

- [ ] Extension never intentionally clicks an anchor, video link, or menu item with `href` while performing dismissal automation.
- [ ] `Not interested` text alone is no longer sufficient; the click must also pass scope, popup, menu-item, and navigation checks.
- [ ] Feed/search keyword, channel, movie/documentary, playlist, and premium-shelf menu actions route through the safe gate.
- [ ] Duration, age/created-time, and sponsored-video filters remain DOM-only and do not invoke menu automation.
- [ ] Watch page sidebar matches remain hide-only.
- [ ] Unsafe/ambiguous cases close the popup, restore scroll, and use a conservative fallback where appropriate.
- [ ] A detected navigation attempt disables further menu automation for the current page/session and logs a loud diagnostic.
- [ ] Harness coverage includes safe dismissal, unsafe menu button, stale/unowned popup, anchor-like `Not interested`, menu item that navigates, and existing scroll-preservation scenarios.

## Success Metrics

- New harness scenarios show zero URL changes from extension-triggered menu automation.
- Existing scroll harness scenarios still pass.
- Console diagnostics clearly explain skipped automation without spamming normal operation.
- The extension still removes/hides matched content when safe dismissal cannot be proven.

## Dependencies & Risks

- **YouTube DOM variability**: Selectors and renderer names may change. Mitigation: prefer structural checks plus conservative fallback over brittle exact DOM assumptions.
- **Harness fidelity**: The local harness can model known bad cases, but not every YouTube production menu. Mitigation: design the gate around invariants: no anchors, scoped popup, stable URL.
- **Over-skipping valid dismissals**: Some valid menu clicks may be skipped. This is acceptable because the requirement prioritizes navigation safety over recommender feedback.
- **Dirty main checkout**: The repository currently has unrelated modified files on `main`. Implementation work should avoid destructive cleanup and should isolate changes to intended files.

## Implementation Phases

The canonical dependency graph lives in `docs/flow/safe-dismissal-clicks.mmd`.

### Phase 1: Characterize unsafe click surface and harness cases

Current phase. Extend the harness to model safe and unsafe YouTube menu states without changing production behavior yet.

Tasks:
- Add harness fixtures for:
  - a valid owned `Not interested` command item
  - menu button nested in or adjacent to an anchor/video link
  - stale popup from a previous card
  - newly opened popup containing anchor-like `Not interested`
  - menu item click that attempts to mutate `location.href`
- Add harness assertions for URL stability, menu click count, `Not interested` click count, fallback removal/hide, and scroll preservation.
- Capture current failures first so the next phase can make them pass.

### Phase 2: Add safe gate helpers

Introduce helper functions in `content/content.js` without fully wiring every action yet.

Tasks:
- Add a safe-action result shape such as `{ ok, reason, target }`.
- Add page eligibility checks for dismissal-safe contexts.
- Add target identity snapshot helpers for title, href/video id/list id where available, bounds, and connected state.
- Add scoped menu-button validation that rejects anchors/link containers and verifies ownership by the matched card/shelf.
- Add popup snapshot/freshness helpers.
- Add exact normalized `Not interested` command matching and non-link menu-item validation.
- Add URL/navigation guard helpers and a page/session flag that disables menu automation after a violation.

### Phase 3: Integrate gate and conservative fallbacks

Replace direct calls to `clickNotInterested()` with the safe dismissal gate while preserving existing queue semantics.

Tasks:
- Refactor `clickNotInterested()` into a gate-aware function, or wrap it with `safeClickNotInterested()`.
- Update default `dismiss`, `block-playlist`, and `dismiss-shelf` actions in `performQueuedFilterAction()`.
- Keep `remove` and `hide` actions unchanged.
- For unsafe `dismiss`, fallback to hide/remove according to page/action context.
- For unsafe `block-playlist`, still add `playlistId` to `blockedPlaylistIds` and remove the card locally.
- For unsafe `dismiss-shelf`, remove/hide locally if the shelf still matches.
- Add structured logging for skip reasons.

### Phase 4: Verification, manual QA notes, and cleanup

Run the harness and perform browser/manual checks on YouTube-like pages.

Tasks:
- Run `node tools/run-scroll-harness.mjs` and ensure old + new scenarios pass.
- Manually validate feed/search dismissal with a safe menu.
- Manually validate ambiguous/unsafe cases are skipped with fallback and no URL change.
- Confirm watch page remains hide-only.
- Confirm duration and age filters still remove locally without menu clicks.
- Remove any noisy debug logs that are not useful diagnostics.

## Flow

Phases for `safe-dismissal-clicks` are defined in [`docs/flow/safe-dismissal-clicks.mmd`](../../flow/safe-dismissal-clicks.mmd). This plan implements **phase `phase-1`**, which has no dependencies.

```mermaid
%% See docs/flow/safe-dismissal-clicks.mmd for the canonical diagram.
```

## References & Research

- Brainstorm source: `docs/brainstorms/2026-06-06-safe-dismissal-clicks-brainstorm.md`
- Project language: `CONTEXT.md`
- Current queue/page routing: `content/content.js:384`
- Duration filter DOM-only removal: `content/content.js:588`
- Age/created-time filter DOM-only removal: `content/content.js:703`
- Playlist click path: `content/content.js:827` and `content/content.js:1771`
- Premium shelf click path: `content/content.js:1104` and `content/content.js:1790`
- Current popup search: `content/content.js:1355`
- Current click target selection: `content/content.js:1375`
- Current click flow: `content/content.js:1630`
- Current action dispatcher: `content/content.js:1752`
- Watch-page safety precedent: `docs/brainstorms/2026-04-06-scanning-optimization-brainstorm.md:49`
- Existing harness: `tools/scroll-harness.html:105` and `tools/run-scroll-harness.mjs:111`
