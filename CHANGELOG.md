# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/): before 1.0, a minor bump for new features or changed behaviour, a patch bump for fixes.

## 0.2.1 — 2026-11-22

First public release, on GitHub.

### Added

- MIT licence.
- Author, homepage, repository and licence in the plugin manifest; the marketplace names its owner.

### Changed

- The install commands in the README point at `ivancarmona/context-meter`.

## 0.2.0 — 2026-11-22

### Added

- Guidelines section: every memory file (CLAUDE.md, the files it imports and `.claude/rules/`) grouped by origin, each with a path that tells same-named files apart (relative to the project, `~/.claude/…` for the user's), then the skill and agent listings (five of each and a line for the rest).
- Every part with detail folds (MCP servers, each memory origin, skills, agents, each model) with a small ▸/▾ beside its name, folded at first; the Guidelines and Usage by model headings start open. The choice outlasts refreshes.
- API billing, detected when responses carry no plan windows (or forced with the `billing` option): the summary shows the session's exact cost instead of the plan windows, and the pane adds usage by model (tokens by kind and cost at first-party table prices, marked ≈ when they drift more than 5 % from the exact total).
- `currency` (`eur` by default) and `usdToEur` options for amounts.
- A gateway's `spend_limit` window is labelled "Spend limit".

### Changed

- The pane's Refresh and Exact recount buttons sit at the top, under the reading time, so a long breakdown never pushes them out of view.
- Plan-limit resets more than a day away show the weekday ("resets Thu 15:00"); nearer ones, the hour alone.
- Quieter controls: buttons are drawn as secondary, and names are cut by the surface at its real width (paths from the start, so the file name stays).
- `showCost` shows the amount in the chosen currency.

### Fixed

- Memory files of the same name in different folders (the user's and the project's CLAUDE.md) were merged into one row; the top-five memory list is replaced by the Guidelines section.

## 0.1.0 — 2026-11-14

Installed locally; not published.

- Pane beside the chat with context-window usage: bar, used categories (biggest first), top memory files, MCP servers, free space and autocompact reserve.
- Refreshes after every turn with the free local estimate; "Exact recount" button for the token-count breakdown `/context` uses.
- Plan limits (5-hour and weekly windows) when the account reports them.
- One toast per crossing of the warning threshold (default 80 %), re-armed when usage drops below it.
- Summary (percentage, tokens, plan limits) above the prompt or in the prompt footer, with a Detail/Hide button that toggles the detail pane; only the percentages are coloured by level. Where no surface seats panes, the detail unfolds under the band.
- The detail pane does not open on its own; `openPaneOnStart` opens it at session start.
- `placement` option: `auto` (footer on terminal and desktop, band elsewhere), `footer` or `above`. The summary is never shown twice; the plugin pins no status line.
- `/context-meter` command to open the pane.
- English and Spanish UI (`language`: auto, es, en). Spanish label for the "MCP server instructions" category.
