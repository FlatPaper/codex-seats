#!/usr/bin/env bash
usage() {
  printf '%s\n' 'Usage: codex-run.sh <cwd> <model|default> <effort> <prompt-file> [read-only] [--agent <path>]' >&2
  exit 2
}
if [ "$#" -lt 4 ]; then
  usage
fi
if [ ! -d "$1" ]; then
  printf 'error: cwd not found: %s\n' "$1" >&2
  exit 2
fi

cwd=$1
model=$2
effort=$3
prompt=$4
shift 4
read_only=false
agent=
agent_set=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    read-only)
      [ "$read_only" = false ] || usage
      read_only=true
      shift
      ;;
    --agent)
      [ "$agent_set" = false ] && [ "$#" -ge 2 ] || usage
      agent=$2
      agent_set=true
      shift 2
      ;;
    *) usage ;;
  esac
done

if [ "$agent_set" = true ] && [ ! -f "$agent" ]; then
  printf 'error: agent file not found: %s\n' "$agent" >&2
  exit 2
fi

shopt -s nullglob
companions=("$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs)
if [ "${#companions[@]}" -eq 0 ]; then
  printf 'error: no companion found at %s\n' "$HOME/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs" >&2
  exit 1
fi
companion=$(node -e 'console.log(process.argv.slice(1).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).pop())' "${companions[@]}") || exit 1

case "$prompt" in
  /*) ;;
  *) prompt="$PWD/$prompt" ;;
esac

log=$prompt
case "${log##*/}" in
  *.*) log="${log%.*}" ;;
esac
log="$log.codex.log"

combined=$prompt
case "${combined##*/}" in
  *.*) combined="${combined%.*}" ;;
esac
if [ "$agent_set" = true ]; then
  agent_name=${agent##*/}
  combined="$combined.${agent_name%.md}.prompt.md"
else
  combined="$combined.prompt.md"
fi
node - "$prompt" "$combined" "$agent" <<'NODE' || exit $?
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const [brief, output, agentFile] = process.argv.slice(2);
let body = agentFile
  ? readFileSync(agentFile, "utf8")
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
      .replace(/^\r?\n/, "")
  : "";
if (body.includes("${CLAUDE_PLUGIN_ROOT}")) {
  let root = dirname(resolve(agentFile));
  while (!existsSync(join(root, ".claude-plugin/plugin.json"))) {
    const parent = dirname(root);
    if (parent === root) {
      console.error(`error: no owning plugin root for agent file: ${agentFile}`);
      process.exit(2);
    }
    root = parent;
  }
  body = body.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
}
if (agentFile) body += "\n---\n";
writeFileSync(output, Buffer.concat([Buffer.from(body), readFileSync(brief)]));
NODE
prompt=$combined

args=(node "$companion" task --cwd "$cwd" --effort "$effort" --prompt-file "$prompt")
if [ "$model" != default ]; then
  args+=(--model "$model")
fi
if [ "$read_only" = false ]; then
  args+=(--write)
fi

printf 'codex progress log: %s\n' "$log" >&2
exec "${args[@]}" </dev/null 2>>"$log"
