import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "skills/codex-seat/SKILL.md");

test("codex-seat skill never contains the literal plugin-root placeholder", () => {
  const text = readFileSync(skill, "utf8");
  const placeholder = "${CLAUDE_PLUGIN_ROOT}";
  assert.ok(!text.includes(placeholder),
    `skills/codex-seat/SKILL.md contains ${placeholder}; Claude Code substitutes it with the plugin install path when the skill loads, so describe the placeholder in words instead`);
});
