# codex-seats

A Claude Code plugin that runs Codex models as subagent seats and shows them in a side pane. A Codex seat is a run of this plugin's `skills/codex-seat/scripts/codex-run.sh`. The pane lists each seat with its task, model, effort, read-only or write, agent, elapsed time, status, and the latest line of its log.

The pane opens by itself when a seat starts. It keeps the last 20 seats.

## Install

At the prompt of a terminal session:

```
/plugin install codex-seats --marketplace FlatPaper/codex-seats
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install codex-seats --marketplace FlatPaper/codex-seats
```

## Use

- `/codex-seats` opens the pane.
- `/codex-seats clear` drops finished seats from the list.

The pane reads a seat from any Bash call whose command runs `codex-run.sh <cwd> <model> <effort> <prompt-file>`. It follows the seat's log at `<prompt-file without its extension>.codex.log`. The seat ends when the log reports the Codex turn finished or the background task's notification arrives.

Read the [codex-seat skill](skills/codex-seat/SKILL.md) before starting a seat. The runner needs Bash, Node.js, and the installed, authenticated `openai-codex` companion plugin. It discovers the newest companion under `~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs`.

```sh
"<this skill's base directory>/scripts/codex-run.sh" /path/to/repo default high /path/to/brief.md read-only --agent /path/to/agent.md
```

Replace `<this skill's base directory>` with the path Claude Code prints when the codex-seat skill loads. Omit `read-only` to allow workspace writes. Omit `--agent` to send the brief alone. The caller's brief carries any worker preamble. `--agent` takes a Markdown file path, strips its YAML frontmatter, and prepends its body to the brief. Placeholders `${CLAUDE_PLUGIN_ROOT}` in that body resolve to the nearest ancestor directory of the agent file that contains `.claude-plugin/plugin.json`. If no such directory exists, the runner exits 2 and names the agent path. The brief stays verbatim.

[`models.md`](models.md) is an optional routing preset with six `role: value` lines in the format of `~/.claude/flatpaper-stack/models.md`. flatpaper-stack's setup offers these lines when codex-seats is installed. The roles cover reviews, arena runners and judges, and interrogate reviewers. Installing the plugin does not change routing automatically.

## Develop

```
claude --plugin-dir /path/to/codex-seats
claude plugin validate /path/to/codex-seats
claude plugin test /path/to/codex-seats
node --test tests/*.test.mjs
for script in skills/codex-seat/scripts/*.sh; do bash -n "$script" || exit; done
shellcheck skills/codex-seat/scripts/*.sh
```

The plugin uses Claude Code's plugin API, which is in early access and can change between releases.
