#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TODO_DIR = "docs/todo";
const DEFAULT_ARCHIVE_DIR = "docs/todo/archive/completed";

function usage() {
  console.log(`Usage: node scripts/run-todos-with-codex.mjs [options]

Scan unfinished goal files under docs/todo, run each through Codex, and archive
a goal only after Codex exits successfully.

Options:
  --dry-run                     Print the goals that would run.
  --limit <n>                   Run at most n goals.
  --only <file>                 Run one goal file, relative to repo root or docs/todo.
  --todo-dir <dir>              Todo directory. Default: ${DEFAULT_TODO_DIR}
  --archive-dir <dir>           Archive directory. Default: ${DEFAULT_ARCHIVE_DIR}
  --codex-bin <bin>             Codex executable. Default: codex
  --runner <mode>               exec or slash-goal. Default: exec
  --model <model>               Pass -m <model> to codex.
  --profile <profile>           Pass -p <profile> to codex.
  --sandbox <mode>              Pass --sandbox <mode>. Default: workspace-write
  --approval <policy>           Pass --ask-for-approval <policy>. Default: never
  --bypass-sandbox              Pass --dangerously-bypass-approvals-and-sandbox.
  --continue-on-failure         Continue to the next goal after a failure.
  --allow-dirty                 Allow starting when git worktree is dirty.
  --no-archive                  Do not move completed goals; useful for testing the runner.
  --verbose                     Print the full Codex command before each goal.
  --help                        Show this help.

Recommended unattended run:
  node scripts/run-todos-with-codex.mjs --allow-dirty

Use --runner slash-goal only for a single interactive /goal run.
slash-goal passes only the goal file path to stay within /goal prompt limits,
but the Codex TUI may stay open after completion, so it cannot reliably queue
multiple goals unattended.
`);
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    limit: Infinity,
    only: "",
    todoDir: DEFAULT_TODO_DIR,
    archiveDir: DEFAULT_ARCHIVE_DIR,
    codexBin: "codex",
    runner: "exec",
    model: "",
    profile: "",
    sandbox: "workspace-write",
    approval: "never",
    bypassSandbox: false,
    continueOnFailure: false,
    allowDirty: false,
    archive: true,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--limit") opts.limit = Number.parseInt(next(), 10);
    else if (arg === "--only") opts.only = next();
    else if (arg === "--todo-dir") opts.todoDir = next();
    else if (arg === "--archive-dir") opts.archiveDir = next();
    else if (arg === "--codex-bin") opts.codexBin = next();
    else if (arg === "--runner") opts.runner = next();
    else if (arg === "--model") opts.model = next();
    else if (arg === "--profile") opts.profile = next();
    else if (arg === "--sandbox") opts.sandbox = next();
    else if (arg === "--approval") opts.approval = next();
    else if (arg === "--bypass-sandbox") opts.bypassSandbox = true;
    else if (arg === "--continue-on-failure") opts.continueOnFailure = true;
    else if (arg === "--allow-dirty") opts.allowDirty = true;
    else if (arg === "--no-archive") opts.archive = false;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(opts.limit) || opts.limit < 1) opts.limit = Infinity;
  if (!["slash-goal", "exec"].includes(opts.runner)) {
    throw new Error(`Invalid --runner: ${opts.runner}. Expected slash-goal or exec.`);
  }
  return opts;
}

function rel(file) {
  return path.relative(ROOT, file);
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
  });
}

function gitStatusPorcelain() {
  const result = run("git", ["status", "--porcelain"]);
  if (result.status !== 0) {
    throw new Error(`git status failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function listGoalFiles(todoDir, only) {
  const absTodoDir = path.resolve(ROOT, todoDir);
  if (only) {
    const candidate = path.isAbsolute(only)
      ? only
      : existsSync(path.resolve(ROOT, only))
        ? path.resolve(ROOT, only)
        : path.resolve(absTodoDir, only);
    if (!existsSync(candidate)) throw new Error(`Goal file not found: ${only}`);
    return [candidate];
  }

  const find = run("find", [absTodoDir, "-maxdepth", "1", "-type", "f", "-name", "*.md"]);
  if (find.status !== 0) {
    throw new Error(`find failed:\n${find.stderr || find.stdout}`);
  }
  return find.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function makePrompt(goalFile, goalText) {
  const rel = path.relative(ROOT, goalFile);
  return `参考 ${rel} 完成开发、测试、以及可上线级别的交付。

要求：
- 读取并严格执行该 goal 文件中的范围、非目标、测试和验收标准。
- 在当前仓库内直接修改代码和测试。
- 不要手动归档、删除或移动 goal 文件；完成后成功退出，外层 runner 会自动归档。
- 如果遇到无法安全完成的问题，明确失败并以非零状态退出，不要伪装完成。
- 完成前做一次对 goal 的逐项审计，确认代码、测试和验证覆盖目标。

Goal 文件内容：

${goalText}
`;
}

function makeSlashGoalPrompt(goalFile, goalText) {
  const rel = path.relative(ROOT, goalFile);
  const lineCount = goalText.split(/\r?\n/).length;
  return `/goal Complete ${rel} without stopping until all acceptance criteria pass.

First read ${rel} (${lineCount} lines) from disk, then execute it exactly. Make code and test changes directly in the current repository. Validate the implementation before stopping. When complete, exit successfully so the outer runner can archive the goal file. Do not manually move, delete, or archive the goal file yourself. If the work cannot be completed safely, stop with a clear failure instead of pretending completion.`;
}

function codexExecArgsFor(opts) {
  const args = ["-a", opts.approval, "exec", "-C", ROOT, "-s", opts.sandbox];
  if (opts.bypassSandbox) args.push("--dangerously-bypass-approvals-and-sandbox");
  if (opts.model) args.push("-m", opts.model);
  if (opts.profile) args.push("-p", opts.profile);
  args.push("-");
  return args;
}

function codexSlashGoalArgsFor(opts, prompt) {
  const args = ["--enable", "goals", "-C", ROOT, "-s", opts.sandbox, "-a", opts.approval];
  if (opts.bypassSandbox) args.push("--dangerously-bypass-approvals-and-sandbox");
  if (opts.model) args.push("-m", opts.model);
  if (opts.profile) args.push("-p", opts.profile);
  args.push(prompt);
  return args;
}

function runCodexGoal(opts, goalFile, index, total) {
  const goalText = readFileSync(goalFile, "utf8");
  const prompt = opts.runner === "slash-goal" ? makeSlashGoalPrompt(goalFile, goalText) : makePrompt(goalFile, goalText);
  const args = opts.runner === "slash-goal" ? codexSlashGoalArgsFor(opts, prompt) : codexExecArgsFor(opts);
  console.log(`\n[${index}/${total}] ${rel(goalFile)}`);
  console.log(`Runner: ${opts.runner}`);
  if (opts.verbose) {
    console.log(
      opts.runner === "slash-goal"
        ? `Command: ${opts.codexBin} --enable goals -C ${ROOT} ... "/goal ..."`
        : `Command: ${opts.codexBin} ${args.join(" ")}`,
    );
  }
  const started = Date.now();
  const result = spawnSync(opts.codexBin, args, {
    cwd: ROOT,
    input: opts.runner === "exec" ? prompt : undefined,
    stdio: opts.runner === "exec" ? ["pipe", "inherit", "inherit"] : "inherit",
    encoding: "utf8",
  });
  return { status: result.status ?? 1, durationMs: Date.now() - started };
}

function archiveGoal(goalFile, archiveDir) {
  const absArchiveDir = path.resolve(ROOT, archiveDir);
  mkdirSync(absArchiveDir, { recursive: true });
  const base = path.basename(goalFile);
  let dest = path.join(absArchiveDir, base);
  if (existsSync(dest)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    dest = path.join(absArchiveDir, `${path.basename(base, ".md")}-${stamp}.md`);
  }
  renameSync(goalFile, dest);
  return dest;
}

function writeRunSummary(summary) {
  const logDir = path.join(ROOT, ".codex-todo-runs");
  mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2) + "\n");
  return file;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = listGoalFiles(opts.todoDir, opts.only).slice(0, opts.limit);
  if (files.length === 0) {
    console.log("No unfinished goal files found.");
    return;
  }
  if (opts.runner === "slash-goal" && files.length > 1) {
    throw new Error(
      "slash-goal starts an interactive Codex TUI and cannot reliably inject a second goal after the first one completes. Use --only <file> for one real /goal run, or use --runner exec for unattended multi-goal runs.",
    );
  }

  console.log(`Found ${files.length} unfinished goal${files.length === 1 ? "" : "s"}.`);
  for (const file of files) console.log(`  - ${rel(file)}`);

  if (opts.dryRun) return;

  if (!opts.allowDirty) {
    const status = gitStatusPorcelain();
    if (status) {
      throw new Error(
        "Refusing to run unattended with a dirty worktree. Commit/stash first, or pass --allow-dirty.\n\n" + status,
      );
    }
  }

  const summary = {
    startedAt: new Date().toISOString(),
    runner: opts.runner,
    sandbox: opts.sandbox,
    approval: opts.approval,
    goals: [],
  };

  console.log(`\nMode: ${opts.runner}, sandbox=${opts.sandbox}, approval=${opts.approval}`);

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const { status, durationMs } = runCodexGoal(opts, file, i + 1, files.length);
    const entry = { goal: rel(file), status, durationMs, archivedTo: null };
    if (status === 0) {
      if (opts.archive) {
        const archived = archiveGoal(file, opts.archiveDir);
        entry.archivedTo = rel(archived);
        console.log(`Status: ok (${formatDuration(durationMs)})`);
        console.log(`Archived: ${entry.archivedTo}`);
      } else {
        console.log(`Status: ok (${formatDuration(durationMs)}), archive skipped`);
      }
    } else {
      console.error(`Status: failed (${formatDuration(durationMs)}), exit ${status}`);
      summary.goals.push(entry);
      if (!opts.continueOnFailure) {
        summary.finishedAt = new Date().toISOString();
        const log = writeRunSummary(summary);
        console.error(`Run summary: ${rel(log)}`);
        process.exit(status);
      }
    }
    summary.goals.push(entry);
  }

  summary.finishedAt = new Date().toISOString();
  const log = writeRunSummary(summary);
  const ok = summary.goals.filter((goal) => goal.status === 0).length;
  const failed = summary.goals.length - ok;
  console.log(`\nDone. ok=${ok}, failed=${failed}`);
  console.log(`Run summary: ${rel(log)}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
