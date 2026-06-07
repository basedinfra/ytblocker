---
title: Safe Dismissal Clicks
date: 2026-06-06
status: captured
---

# Safe Dismissal Clicks

YTBlocker should never accidentally navigate to a video while trying to dismiss a recommendation. The chosen design is a conservative safety gate around YouTube menu automation: only perform a real menu-item click when the extension can prove the click is scoped to the matched card, opens the intended menu, and targets a non-link "Not interested" action. If proof fails at any stage, the extension should use a conservative fallback such as hide/remove and log the reason.

This keeps the extension robust without creating false positives. The goal is not to make every matched item eligible for YouTube's feedback flow; the goal is to make every committed click non-navigational.

## Problem

The current extension performs menu automation in `content/content.js` for some recommendation filters. `clickNotInterested()` hovers a matched card, finds a menu button, clicks it, finds a visible popup item containing "Not interested", then clicks that item. That is useful when YouTube exposes the expected menu, but it is risky if the menu button belongs to a nested/unrelated element, if the popup is not the one opened by this card, or if the matched text points to a link-like target.

The project already has prior protection: watch-page sidebar matches use hide-only behavior because dismissal clicks can navigate the main player, and duration/created-time filters currently enqueue `remove`, not menu dismissal. The new design should extend that conservative posture to all real clicks, especially feed/search dismissal and shelf/playlist dismissal flows.

## Approaches Considered

### Option A: Multi-stage Safe Dismissal Gate (RECOMMENDED)

Treat "Not interested" text as one validation signal, not as sufficient proof. Before each click, validate the candidate card, menu button, popup, menu item, and navigation state. Commit the click only if every check passes; otherwise skip menu automation and use conservative fallback.

- Pros: Most robust against accidental video navigation; preserves dismissal where YouTube exposes a clear safe menu; keeps false positives low because uncertainty causes skip, not click.
- Cons: Some valid dismissals may be skipped when YouTube's DOM is ambiguous; requires more structured helper functions and logging.
- Best when: Safety is load-bearing and the extension must never click through to a video from automation.

### Option B: Text-Only "Not Interested" Matching

Keep the current basic flow but tighten popup item selection to exact normalized text matching for "Not interested".

- Pros: Simple and low-effort; reduces some false matches from substring matching.
- Cons: Still cannot prove the popup belongs to the matched card; still cannot prove the click target is non-navigational; fragile across YouTube locales/copy changes; does not solve accidental menu-button/navigation clicks.
- Best when: The only observed bug is choosing the wrong menu item text, which is not the full risk here.

### Option C: No Menu Clicks, DOM-Only Filtering

Stop using YouTube menu automation entirely. All filters hide/remove matching cards locally and never click YouTube UI.

- Pros: Strongest navigation safety; simpler mental model; avoids YouTube feedback-flow fragility.
- Cons: Loses the account-level "Not interested" feedback benefit; matching cards may return later because YouTube was never told to downrank them.
- Best when: Zero automation risk is more important than teaching YouTube's recommender.

## Key Decisions

- **Use a safe dismissal gate, not text alone**: The text "Not interested" is necessary but not sufficient. A safe click must also prove card scope, menu-button scope, popup freshness, non-link target, visibility, and stable URL before/after the click.
- **Keep duration and created-time filters DOM-only**: In the current code, duration and age scans enqueue `remove`, so they already avoid real clicks. They should not be upgraded to menu dismissal unless they pass the same safe dismissal gate.
- **Fallback conservatively when uncertain**: If any validation step fails, do not click. Hide/remove the card when appropriate and log a structured reason such as `unsafe-menu-button`, `popup-not-owned`, `not-interested-not-found`, or `target-is-link`.
- **Treat page context as part of safety**: Watch pages should remain hide-only. Feed/search can attempt safe dismissal, but only after page-type and URL guards pass.

## Safe Dismissal Gate Design

The gate should be conceptually organized around these checkpoints:

1. **Eligibility check before opening a menu**
   - The action must be budgeted and enabled.
   - `currentPageType` must be a dismissal-safe page, likely feed or search only.
   - The target element must still be connected, visible enough, and not itself a video link.
   - The target must have a stable identity snapshot: title, channel text when available, href/video id/list id when available, and DOM position.

2. **Scoped menu-button discovery**
   - Search only inside the matched card/shelf, not globally.
   - Reject buttons inside anchor elements or obvious video-link containers.
   - Prefer buttons with known labels: "More actions", "Action menu".
   - Verify the button's closest card/renderer is the original target or inside it.

3. **Popup ownership/freshness check after opening**
   - Capture the set of existing visible popups before opening the menu.
   - After the menu button click, only inspect newly visible or changed popups.
   - Reject if multiple plausible popups appear and ownership cannot be inferred.
   - Optionally compare popup screen position against the menu button/card bounds.

4. **Menu-item validation**
   - Normalize text and require exact or locale-aware match for "Not interested"; do not use broad substring matching alone.
   - Reject anchors (`a[href]`) and any item with href-like navigation behavior.
   - Require a menu-item role/renderer shape expected for command items, not arbitrary `a`, `button`, or `li` from the whole popup.
   - Verify the menu item is visible and enabled.

5. **Navigation guard around committed clicks**
   - Snapshot `location.href`, `history.length`, and preferably YouTube page identity before clicking.
   - Install a short-lived guard/listener around `yt-navigate-start` / URL changes if feasible.
   - After the click, verify the URL did not change to `/watch`, `/shorts`, or a different video-bearing route.
   - If navigation is detected, log loudly and disable further menu automation for the page/session.

6. **Conservative fallback**
   - On any failed checkpoint, close the popup, restore scroll, and use the fallback for that action.
   - For keyword/channel/movie/shelf matches, fallback can usually hide/remove locally.
   - For playlists, continue remembering the playlist id locally if available, then remove locally.

## How This Applies to Existing Filters

- **Keyword matches**: Can attempt safe dismissal on feed/search. Watch remains hide-only. If unsafe, fallback hide/remove.
- **Channel matches**: Same as keyword matches, because they currently route through `enqueueVideoMatch()` and may dismiss on feed.
- **Movie/documentary recommendation matches**: Same as keyword/channel because they route through `enqueueVideoMatch()`.
- **Premium shelf dismissal**: Should pass through the same gate before clicking. If the shelf menu is ambiguous, remove/hide locally instead.
- **Playlist block**: If the playlist card is in viewport, current behavior attempts menu dismissal and then removes the card. This should use the safe gate; if unsafe, still add the playlist id to local blocked ids and remove locally.
- **Duration filter**: Already enqueues `remove` at `content/content.js:588`; no menu click needed.
- **Created-time / age filter**: Already enqueues `remove` at `content/content.js:703`; no menu click needed.
- **Sponsored videos**: Currently enqueue `remove`; keep DOM-only unless a future reason exists to use YouTube feedback.
- **Watch page sidebar**: Keep hide-only because the earlier brainstorm documents that menu dismissal there can navigate.

## Open Questions

- Should the safe gate disable all menu automation for the current page after one detected navigation attempt, or only skip that one target? Recommendation: disable for the page/session after any navigation guard violation.
- Should the extension expose a popup/debug counter for skipped unsafe dismissals? Recommendation: log only for now; a UI counter is probably YAGNI.
- Should locale support be added for non-English "Not interested" text? Recommendation: defer unless the user uses YouTube in another language.

## Language

**Safe dismissal click**: A YouTube menu automation click that is allowed only after pre-click and post-menu validation prove it targets the matched card's "Not interested" action, not a video link or unrelated menu item.
_Avoid_: valid click, real click, safe click

**Conservative fallback**: The non-navigation fallback used when a safe dismissal click cannot be proven, usually hiding or removing the card and logging why menu automation was skipped.
_Avoid_: failure, false positive, best effort

(Synced with the project's `CONTEXT.md`.)

## ADRs Created

None. This is important behavior, but it does not appear hard enough to reverse or surprising enough to require a separate ADR yet. If later planning chooses to permanently abandon all YouTube feedback clicks, that would likely deserve an ADR.

## References

- Current click flow: `content/content.js:1630` (`clickNotInterested()` opens the menu and clicks the found item)
- Current menu item search: `content/content.js:1355` (`findNotInterestedItem()` scans visible popups for text containing "not interested")
- Current popup close behavior: `content/content.js:1419`
- Current queue/action dispatcher: `content/content.js:1752`
- Duration filter is DOM-only: `content/content.js:588`
- Created-time/age filter is DOM-only: `content/content.js:703`
- Watch-page safety precedent: `content/content.js:390` and `docs/brainstorms/2026-04-06-scanning-optimization-brainstorm.md:49`
