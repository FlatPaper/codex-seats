import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "skills/codex-seat/scripts/codex-run.sh");
const usage = "Usage: codex-run.sh <cwd> <model|default> <effort> <prompt-file> [read-only] [--agent <path>]\n";

function fixture(t, { versions = ["1.0.2", "1.0.10", "1.0.9"], exitCode = 0, promptName = "brief draft.md" } = {}) {
  const home = mkdtempSync(join(tmpdir(), "codex-seats-run-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const cwd = join(home, "project.with spaces");
  mkdirSync(cwd);
  const prompt = join(cwd, promptName);
  writeFileSync(prompt, "Inspect the project.\n");
  const log = join(cwd, promptName.replace(/\.[^.]*$/, "") + ".codex.log");
  for (const version of versions) {
    const companion = join(home, ".claude/plugins/cache/openai-codex/codex", version, "scripts/codex-companion.mjs");
    mkdirSync(dirname(companion), { recursive: true });
    writeFileSync(companion, `
import { readFileSync } from "node:fs";
const input = readFileSync(0, "utf8");
const argv = process.argv.slice(2);
const promptContents = readFileSync(argv[argv.indexOf("--prompt-file") + 1], "utf8");
console.log(JSON.stringify({ version: ${JSON.stringify(version)}, argv, stdinEOF: true, input, promptContents }));
console.error("companion progress");
process.exit(${exitCode});
`);
  }
  const agent = join(home, "agent prompts", "reviewer.md");
  mkdirSync(join(home, ".claude-plugin"));
  writeFileSync(join(home, ".claude-plugin/plugin.json"), "{}");
  mkdirSync(dirname(agent));
  writeFileSync(agent, "---\r\nname: reviewer\r\ndescription: Review a project.\r\n---\r\n\r\n# Reviewer\r\nRead ${CLAUDE_PLUGIN_ROOT}/instructions.md.\r\n");
  const args = [cwd, "gpt-5.4", "high", prompt];
  const options = { env: { ...process.env, HOME: home }, encoding: "utf8", timeout: 5000 };
  delete options.env.CLAUDE_PLUGIN_ROOT;
  const run = (argv = args) => {
    const result = spawnSync(script, argv, options);
    assert.ifError(result.error);
    return result;
  };
  const combined = prompt.replace(/\.[^.]*$/, "") + ".prompt.md";
  const expected = ["task", "--cwd", cwd, "--effort", "high", "--prompt-file", combined];
  return { home, agent, cwd, prompt, combined, log, args, options, run, expected };
}

test("picks version 1.0.10 over 1.0.9 and 1.0.2", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).version, "1.0.10");
});

test("write mode passes the exact argv", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).argv, [...f.expected, "--model", "gpt-5.4", "--write"]);
  assert.equal(JSON.parse(result.stdout).promptContents, readFileSync(f.prompt, "utf8"));
});

test("a seat without --agent sends its verbatim brief without a preamble", (t) => {
  const f = fixture(t);
  const brief = "Review the diff.\r\nKeep ${CLAUDE_PLUGIN_ROOT} verbatim.";
  writeFileSync(f.prompt, brief);
  const result = f.run([...f.args, "read-only"]);
  assert.equal(result.status, 0, result.stderr);
  const { argv, promptContents } = JSON.parse(result.stdout);
  assert.deepEqual(argv, [...f.expected, "--model", "gpt-5.4"]);
  assert.equal(promptContents, brief);
  assert.equal(readFileSync(f.combined, "utf8"), promptContents);
  assert.equal(readFileSync(f.prompt, "utf8"), brief);
});

test("--agent sends the resolved agent body and verbatim brief through a combined prompt", (t) => {
  const f = fixture(t);
  f.options.env.CLAUDE_PLUGIN_ROOT = "/caller/plugin root";
  const brief = "Inspect the project.\r\nKeep `literal $text` verbatim without a final newline.";
  writeFileSync(f.prompt, brief);
  const result = f.run([...f.args, "--agent", f.agent]);
  assert.equal(result.status, 0, result.stderr);
  const { argv, promptContents } = JSON.parse(result.stdout);
  const combined = f.prompt.replace(/\.[^.]*$/, ".reviewer.prompt.md");
  assert.deepEqual(argv, [...f.expected.slice(0, -1), combined, "--model", "gpt-5.4", "--write"]);
  assert.ok(promptContents.startsWith("# Reviewer\r\n"));
  const body = promptContents.slice(0, -brief.length);
  assert.doesNotMatch(body, /^name:|^description:|^---\r?\nname:/m);
  assert.ok(body.includes(`${f.home}/instructions.md`));
  assert.ok(!promptContents.includes("${CLAUDE_PLUGIN_ROOT}"));
  assert.ok(promptContents.endsWith(`\n---\n${brief}`));
  assert.equal(readFileSync(combined, "utf8"), promptContents);
  assert.equal(readFileSync(f.prompt, "utf8"), brief);
  assert.equal(result.stderr, `codex progress log: ${f.log}\n`);
  writeFileSync(combined, "stale combined prompt");
  const rerun = f.run([...f.args, "--agent", f.agent]);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(JSON.parse(rerun.stdout).promptContents, promptContents);
});

test("--agent preserves plugin-root placeholders in the brief verbatim", (t) => {
  const f = fixture(t);
  f.options.env.CLAUDE_PLUGIN_ROOT = "/caller/plugin root";
  const brief = "Keep ${CLAUDE_PLUGIN_ROOT} in the brief.\n";
  writeFileSync(f.prompt, brief);
  const result = f.run([...f.args, "--agent", f.agent]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).promptContents.endsWith(`\n---\n${brief}`));
});

test("--agent resolves plugin-root placeholders when the environment is unset", (t) => {
  const f = fixture(t);
  const result = f.run([...f.args, "--agent", f.agent]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).promptContents,
    `# Reviewer\r\nRead ${f.home}/instructions.md.\r\n\n---\nInspect the project.\n`);
});

test("--agent uses the nearest plugin root and ignores an empty environment value", (t) => {
  const f = fixture(t);
  f.options.env.CLAUDE_PLUGIN_ROOT = "";
  const owner = dirname(f.agent);
  mkdirSync(join(owner, ".claude-plugin"));
  writeFileSync(join(owner, ".claude-plugin/plugin.json"), "{}");
  writeFileSync(f.agent, "Read ${CLAUDE_PLUGIN_ROOT}/instructions.md.");
  const result = f.run([...f.args, "--agent", f.agent]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).promptContents,
    `Read ${owner}/instructions.md.\n---\nInspect the project.\n`);
});

test("--agent with a placeholder but no owning plugin exits 2 and names the agent", (t) => {
  const f = fixture(t);
  rmSync(join(f.home, ".claude-plugin"), { recursive: true });
  f.options.env.CLAUDE_PLUGIN_ROOT = "/caller/plugin root";
  const result = f.run([...f.args, "--agent", f.agent]);
  assert.deepEqual([result.status, result.stdout, result.stderr], [2, "",
    `error: no owning plugin root for agent file: ${f.agent}\n`]);
});

test("--agent without a placeholder does not require an owning plugin", (t) => {
  const f = fixture(t);
  rmSync(join(f.home, ".claude-plugin"), { recursive: true });
  writeFileSync(f.agent, "Review the project.");
  const result = f.run([...f.args, "--agent", f.agent]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).promptContents,
    "Review the project.\n---\nInspect the project.\n");
});

test("--agent resolves a relative path against the caller, not the seat cwd", (t) => {
  const f = fixture(t);
  const result = spawnSync(script, [...f.args, "--agent", "agent prompts/reviewer.md"],
    { ...f.options, cwd: f.home });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).promptContents,
    `# Reviewer\r\nRead ${realpathSync(f.home)}/instructions.md.\r\n\n---\nInspect the project.\n`);
});

test("--agent resolves an extensionless relative brief beside its combined prompt", (t) => {
  const f = fixture(t, { promptName: "brief" });
  const result = spawnSync(script, [f.cwd, "default", "high", "brief", "--agent", f.agent],
    { ...f.options, cwd: f.cwd });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const prompt = join(realpathSync(f.cwd), "brief.reviewer.prompt.md");
  assert.deepEqual(JSON.parse(result.stdout).argv,
    ["task", "--cwd", f.cwd, "--effort", "high", "--prompt-file", prompt, "--write"]);
  assert.equal(readFileSync(prompt, "utf8"), JSON.parse(result.stdout).promptContents);
});

for (const readOnlyFirst of [true, false]) {
  test(`--agent accepts read-only first=${readOnlyFirst}`, (t) => {
    const f = fixture(t);
    const extra = readOnlyFirst ? ["read-only", "--agent", f.agent] : ["--agent", f.agent, "read-only"];
    const result = f.run([...f.args, ...extra]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).argv,
      [...f.expected.slice(0, -1), f.prompt.replace(/\.[^.]*$/, ".reviewer.prompt.md"), "--model", "gpt-5.4"]);
  });
}

for (const name of ["missing-agent.md", "nested/agent.md", "..", ""]) {
  test(`missing agent file ${JSON.stringify(name)} exits 2 before running the companion`, (t) => {
    const f = fixture(t, { versions: [] });
    const result = f.run([...f.args, "--agent", name]);
    assert.deepEqual([result.status, result.stdout, result.stderr], [2, "",
      `error: agent file not found: ${name}\n`]);
  });
}

for (const extra of [["--agent"], ["read-only", "read-only"], ["--agent", "agent.md", "--agent", "agent.md"], ["--agent", "agent.md", "--background"]]) {
  test(`invalid options ${extra.join(" ")} produce a usage error`, (t) => {
    const f = fixture(t);
    const result = f.run([...f.args, ...extra]);
    assert.deepEqual([result.status, result.stdout, result.stderr], [2, "", usage]);
  });
}

test("cwd validation precedes optional argument validation", (t) => {
  const f = fixture(t);
  const missing = join(f.home, "missing project");
  const result = f.run([missing, ...f.args.slice(1), "--agent", "../agent"]);
  assert.deepEqual([result.status, result.stdout, result.stderr], [2, "", `error: cwd not found: ${missing}\n`]);
});

test("read-only mode passes the exact argv without --write", (t) => {
  const f = fixture(t);
  const result = f.run([...f.args, "read-only"]);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).argv, [...f.expected, "--model", "gpt-5.4"]);
});

test("default model passes the exact argv without --model", (t) => {
  const f = fixture(t);
  const result = f.run([f.cwd, "default", "high", f.prompt]);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).argv, [...f.expected, "--write"]);
});

test("stdout contains only companion output and progress appends to the log", (t) => {
  const f = fixture(t);
  writeFileSync(f.log, "earlier progress\n");
  const result = f.run();
  assert.equal(result.status, 0);
  assert.equal(result.stdout, JSON.stringify({
    version: "1.0.10", argv: [...f.expected, "--model", "gpt-5.4", "--write"], stdinEOF: true, input: "", promptContents: "Inspect the project.\n",
  }) + "\n");
  assert.equal(result.stderr, `codex progress log: ${f.log}\n`);
  assert.equal(readFileSync(f.log, "utf8"), "earlier progress\ncompanion progress\n");
});

test("extensionless prompt in a dotted directory gets a .codex.log suffix", (t) => {
  const f = fixture(t, { promptName: "brief" });
  const result = f.run();
  assert.equal(result.status, 0);
  assert.equal(result.stderr, `codex progress log: ${f.log}\n`);
  assert.equal(readFileSync(f.log, "utf8"), "companion progress\n");
});

test("regression: an unclosed stdin pipe still gives the companion immediate EOF", { timeout: 10000 }, async (t) => {
  const f = fixture(t);
  const child = spawn(script, f.args, { ...f.options, timeout: undefined, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => (stdout += data));
  child.stderr.on("data", (data) => (stderr += data));
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timed out waiting for EOF with the parent stdin pipe still open"));
    }, 3000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (status) => { clearTimeout(timer); resolve(status); });
  });
  assert.equal(code, 0, stderr);
  assert.equal(child.stdin.writableEnded, false);
  assert.equal(JSON.parse(stdout).stdinEOF, true);
  assert.equal(JSON.parse(stdout).input, "");
});

test("companion exit code passes through", (t) => {
  const f = fixture(t, { exitCode: 37 });
  assert.equal(f.run().status, 37);
});

test("three arguments produce a one-line usage error and exit 2", (t) => {
  const f = fixture(t);
  const result = f.run(f.args.slice(0, 3));
  assert.deepEqual([result.status, result.stdout, result.stderr], [2, "", usage]);
});

test("a bad fifth argument produces a one-line usage error and exit 2", (t) => {
  const f = fixture(t);
  const result = f.run([...f.args, "--background"]);
  assert.deepEqual([result.status, result.stdout, result.stderr], [2, "", usage]);
});

test("a nonexistent cwd names the path, exits 2, and never runs the companion", (t) => {
  const f = fixture(t);
  const missing = join(f.home, "missing project");
  const result = f.run([missing, "gpt-5.4", "high", f.prompt]);
  assert.deepEqual([result.status, result.stdout, result.stderr], [2, "", `error: cwd not found: ${missing}\n`]);
});

test("a missing companion names the path pattern and exits 1", (t) => {
  const f = fixture(t, { versions: [] });
  const result = f.run();
  assert.deepEqual([result.status, result.stdout, result.stderr], [1, "",
    `error: no companion found at ${f.home}/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs\n`]);
});

test("a relative prompt path resolves against the caller's directory, not the cwd argument", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.home, "caller dir"));
  const caller = realpathSync(join(f.home, "caller dir"));
  const prompt = join(caller, "relative brief.md");
  writeFileSync(prompt, "Inspect the project.\n");
  const log = join(caller, "relative brief.codex.log");
  const result = spawnSync(script, [f.cwd, "gpt-5.4", "high", "relative brief.md"], { ...f.options, cwd: caller });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).argv,
    ["task", "--cwd", f.cwd, "--effort", "high", "--prompt-file", join(caller, "relative brief.prompt.md"), "--model", "gpt-5.4", "--write"]);
  assert.equal(result.stderr, `codex progress log: ${log}\n`);
  assert.equal(readFileSync(log, "utf8"), "companion progress\n");
});
