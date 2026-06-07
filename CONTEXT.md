# YTBlocker

YTBlocker is a Chrome Manifest V3 content-script extension for YouTube that removes or blocks unwanted recommendations and surfaces based on content type, keyword, duration, or age. This context file captures shared project language for brainstorms, plans, and ADRs.

## Language

**Safe dismissal click**: A YouTube menu automation click that is allowed only after pre-click and post-menu validation prove it targets the matched card's "Not interested" action, not a video link or unrelated menu item.
_Avoid_: valid click, real click, safe click

**Conservative fallback**: The non-navigation fallback used when a safe dismissal click cannot be proven, usually hiding or removing the card and logging why menu automation was skipped.
_Avoid_: failure, false positive, best effort

