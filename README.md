# context-meter

A Claude Code mod that shows, right above the prompt, how full the context window is and what is filling it. It works in the terminal, the desktop app and the VS Code extension.

Above the prompt, always (each percentage green, yellow or red by level; the rest dim):

```
Context 13 % · 131k/1.0M · 5 h 34 % · Weekly 12 %   [Detail]
```

**Detail** opens the full pane (and turns into **Hide**):

```
███████████░░░░░░░░░  58 %  116k/200k
estimated · updated 21:40
[Refresh] [Exact recount]
Messages                     71k
MCP tools                    18k
  playwright                 14k
System prompt                12k
Memory files                  9k
Free                         84k
Guidelines                   15k
User                          2k
  ~/.claude/CLAUDE.md         2k
Project                       7k
  CLAUDE.md                   4k
  docs/style.md               3k
Skills                        6k
  ...
Plan limits
5 h: 34 % (resets 23:00)
Weekly: 12 % (resets Thu 15:00)
```

## What it does

- **Updates after every turn** with the session's own usage figures (the same source as the status line and `/context`). The per-turn reading is a local estimate and costs nothing.
- **Exact recount** button: counts every category with the token-count API, as `/context` does. Runs only when pressed.
- **Breakdown**: used categories (biggest first) and the loaded MCP servers, free space and autocompact reserve.
- **Guidelines**: what the standing instructions cost, file by file. Every memory file (CLAUDE.md and the files it imports) grouped by origin (managed, user, project, local, auto memory), then the skill and agent listings. Hook output is not listed: it lands in Messages and the usage figures do not say which hook added it.
- **Plan limits**: the 5-hour and weekly windows, when the account reports them.
- **API billing**: with an API key (no plan windows in the responses, or `billing: api`) the summary shows the session's cost instead of the plan windows (`Context 5 % · 47k/1.0M · Session €3.42`), and the pane adds **Usage by model**: total tokens, then each model with its cost, folding into input, output, cache read and cache write. The total is the engine's own ledger (as `/cost`); the per-model amounts use first-party API prices built into the mod, and are marked ≈ when they drift more than 5 % from the total (a model the table lacks, Bedrock or Vertex rates, 1-hour cache writes). A gateway's spend limit still shows.
- **Warning**: one toast when usage crosses the threshold (80 % by default), re-armed once it drops below. It never compacts on its own.
- **Summary** in the prompt footer (terminal, desktop) or a band above the prompt (VS Code), with a Detail/Hide button for the pane; only the percentages are coloured. It is never shown twice. Where a surface does not seat panes, the detail unfolds under the band.
- `/context-meter` opens the pane.

## Install

From a terminal session of Claude Code:

```
/plugin install context-meter --marketplace ivancarmona/context-meter
```

Or from a shell:

```
claude plugin install context-meter --marketplace ivancarmona/context-meter
```

VS Code extension users without the `claude` CLI on their PATH can run the same command with the binary bundled in the extension: `<extensions folder>/anthropic.claude-code-<version>/resources/native-binary/claude(.exe)`. A plugin installed at user scope loads in every new session, the VS Code panel included.

### From a local folder

```
claude plugin marketplace add /path/to/context-meter
claude plugin install context-meter@context-meter
```

The plugin is then read from that folder: edit it and run `/reload-plugins`.

## Options

Set them in the config menu (`/config`) or under `pluginConfigs` in settings.

| Option | Default | Meaning |
|---|---|---|
| `language` | `auto` | `auto` (settings language, then system locale), `es` or `en` |
| `warnPercent` | `80` | Threshold for the one-off toast |
| `showRateLimits` | `true` | Show the 5-hour and weekly windows |
| `showCost` | `false` | On a subscription, show the session's API-equivalent cost (not a real charge on Pro/Max plans); on API billing the cost is always shown |
| `billing` | `auto` | `auto` (subscription when responses report the 5-hour and weekly windows, API otherwise), `plan` or `api` |
| `currency` | `eur` | `eur` or `usd` for amounts |
| `usdToEur` | `0.86` | Euros per US dollar, a fixed rate to update now and then |
| `openPaneOnStart` | `false` | Open the detail pane when a session starts |
| `placement` | `auto` | Where the summary goes: `auto` (prompt footer on terminal and desktop, band above the prompt elsewhere), `footer` or `above` |

## Requirements

Claude Code 2.1.322 or later. Mods run on the hooks-module API, which is in early access and changes between releases: if a new version breaks the pane, run `claude plugin validate` on the folder and open an issue.

## Development

```
claude plugin validate .
claude plugin test .
```

## Uninstall

```
claude plugin uninstall context-meter
claude plugin marketplace remove context-meter
```

## License

[MIT](LICENSE)
