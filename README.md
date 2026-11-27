# codex-seats

A Claude Code mod that shows the Codex seats a session starts in a side pane. A Codex seat is a run of flatpaper-stack's `codex-run.sh`. The pane lists each seat with its task, model, effort, read-only or write, agent, elapsed time, status, and the latest line of its log.

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

The mod reads a seat from any Bash call whose command runs `codex-run.sh <cwd> <model> <effort> <prompt-file>`. It follows the seat's log at `<prompt-file without its extension>.codex.log`. The seat ends when the log reports the Codex turn finished or the background task's notification arrives.

## Develop

```
claude --plugin-dir /path/to/codex-seats
claude plugin validate /path/to/codex-seats
claude plugin test /path/to/codex-seats
```

The mod uses Claude Code's plugin API, which is in early access and can change between releases.
