---
name: codex-seat
description: Read before running a Codex model as a subagent seat, choosing codex/matched, or giving a Codex seat browser access.
---

# Run a Codex seat

Use Bash and Node.js with an installed, authenticated `openai-codex` companion plugin. The runner selects the newest companion under `~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs`.

## Model and effort

The plugin root's `models.md` provides six optional `role: value` lines. flatpaper-stack's setup offers these lines when codex-seats is installed. Installing the plugin does not change routing automatically.

A `codex/<model>` routing value passes `<model>` to the runner. `codex/default` passes `default`, which uses Codex's default model.

For `codex/matched`, use the Codex model at the parent's tier:

| Parent tier | Codex model |
|---|---|
| Fable | `gpt-6-astra` |
| Opus | `gpt-6.1-sol` |
| Sonnet | `gpt-6.1-terra` |
| Haiku | `gpt-6-luna` |

If the matched model is unavailable, use `codex/default`.

Always pass the routing role's effort, or `medium` when the role omits effort. If the log reports `Unsupported reasoning effort`, rerun at the companion's highest accepted effort and report the change. The stock companion accepts up to `xhigh`.

A Codex seat runs as a background Bash command. Claude Agent options, including `subagent_type`, `model`, `effort`, and `isolation`, do not configure the seat. Codex seats do not have Claude subagent MCP tools, `SendMessage`, or their own Claude wake-ups. If the task requires those capabilities, use an available Claude seat.

## Start and monitor

1. Write the brief to a file, such as `<scratchpad>/codex-review.md`. The caller's brief carries any worker preamble. The runner adds no `worker.md` instruction.
2. Run the following command with Bash `run_in_background: true` and the description `Codex: <task>`.

	```sh
	"<this skill's base directory>/scripts/codex-run.sh" <cwd> <model|default> <effort> <prompt-file> [read-only] [--agent <path>]
	```

	Replace `<this skill's base directory>` with the path Claude Code prints as `Base directory for this skill` when this skill loads. `<cwd>` is the seat's working directory. A writing seat beside other writers needs its own worktree. Add `read-only` when the seat must not write.
3. To prepend an agent definition, pass `--agent /absolute/path/to/agent.md`. The runner strips YAML frontmatter and puts the body before the brief, separated by `---`. Paths to the brief and agent can be relative to the caller's directory. They do not resolve against `<cwd>`.
4. For a list of seats, send one background command per seat in the same message.
5. End your turn. Read the command's output file when its completion notification arrives. Stdout contains only the companion's final answer.
6. Read `<prompt-file without its extension>.codex.log` to watch progress. The runner prints that path on stderr and appends companion stderr there. The pane watches this same path, including when `--agent` is present.
7. Call `TaskStop` on the background command to stop the seat.

`read-only` and `--agent <path>` can appear in either order after the four required arguments. Without `read-only`, the runner passes `--write`. With `default`, it omits the companion's `--model` argument.
The calling plugin's instructions decide when a seat runs `read-only` and which agent file it passes, and this skill only documents the arguments.

The runner replaces the plugin-root placeholder in the agent body, the name `CLAUDE_PLUGIN_ROOT` wrapped in a dollar sign and curly braces, with the nearest ancestor directory of the agent file that contains `.claude-plugin/plugin.json`. If the body uses the placeholder and no such directory exists, the runner exits 2 and names the agent path. The brief remains verbatim.

The runner writes a combined prompt beside the brief. For `brief.md`, the output is `brief.prompt.md`, or `brief.reviewer.prompt.md` with an agent named `reviewer.md`. Each rerun overwrites that combined prompt. Use a separate brief path for each concurrent seat.

## Codex sandbox

The runner passes `--write` unless you add `read-only`. On macOS, the read-only sandbox refuses git and temporary file writes. For a reviewer that needs those operations, use write mode with a throwaway detached worktree at the reviewed head as `<cwd>`.

Write mode still refuses localhost servers and the network unless `~/.codex/config.toml` sets `network_access = true` under `[sandbox_workspace_write]`. Claude Code's sandbox also limits outbound hosts to its allowlist. Without that setting, use a Claude reviewer for checks that need the network or localhost. If the user required Codex, report the blocked checks and leave the review pending. Never run Codex with full access.

## Browser for a Codex seat

On macOS, the Codex sandbox refuses to launch Chromium. The browser helper refuses `start` inside a Codex sandbox because launch attempts can crash Chrome and raise a macOS crash dialog.

Start Chrome from the calling session:

```sh
"<this skill's base directory>/scripts/browser-for-seat.sh" start <dir>
```

Put the printed `port=<number>` and the page server's URL in the seat's brief. Tell the seat to connect with Node's built-in WebSocket or a CDP client and never launch a browser. The seat needs `network_access = true`. Without it, use a Claude reviewer for browser checks.

After the seat reports, close Chrome through DevTools:

```sh
"<this skill's base directory>/scripts/browser-for-seat.sh" stop <dir>
```

`start` refuses a profile locked by another Chrome. `stop` keeps the directory when it cannot confirm Chrome has stopped. Set `CHROME` to an executable path if automatic Chrome discovery fails.
