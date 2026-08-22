/**
 * Deterministic subagent execution.
 *
 * Spawns a dedicated headless `pi` process per task (same contract as the
 * subagent extension: --mode json -p --no-session) so workflow phases delegate
 * work by construction rather than by hoping the model calls the `subagent`
 * tool. Agent definitions come from ~/.pi/agent/agents/<name>.md (same
 * frontmatter format: name, description, optional model, tools).
 *
 * The `subagent` extension itself stays untouched and remains available to the
 * model for ad-hoc delegation outside workflows.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const OUTPUT_CAP = 50 * 1024;

/**
 * Per-subagent timeout. Default 20 min; override with
 * GSTACK_PI_SUBAGENT_TIMEOUT (seconds, e.g. "300" for 5 min).
 */
function defaultTimeoutMs(): number {
  const raw = process.env.GSTACK_PI_SUBAGENT_TIMEOUT;
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  }
  return DEFAULT_TIMEOUT_MS;
}

export interface AgentDef {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  filePath: string;
}

export interface SpawnRequest {
  agent: string;
  task: string;
  cwd: string;
  timeoutMs?: number;
  /**
   * Polled once per second; when it returns true (e.g. the session was
   * reloaded mid-run) the child process is killed and the run aborts.
   */
  shouldAbort?: () => boolean;
  /**
   * Live activity feed from the child's JSON event stream (current tool call,
   * assistant text preview). Lets the orchestrator show progress without a
   * tool-renderer — deterministic spawns run outside any tool call.
   */
  onActivity?: (label: string) => void;
}

/**
 * Derive a short human-readable activity label from one JSON stream event.
 * Defensive by design: the stream schema is pi-internal, so every access is
 * guarded and unknown shapes simply yield no label.
 */
export function activityLabelFromEvent(event: any): string | null {
  try {
    if (event?.type === "tool_execution_start") {
      const name = event.toolName ?? event.name ?? event.tool?.name ?? "tool";
      const args = event.args ?? event.input ?? event.tool?.args ?? {};
      const target =
        args.file_path ?? args.path ?? args.command ?? args.pattern ?? args.url ?? args.query ?? "";
      return target ? `${name}: ${String(target).slice(0, 48)}` : String(name);
    }
    if (event?.type === "message_start" && event.message?.role === "assistant") {
      return "thinking…";
    }
    if (event?.type === "message_end" && event.message?.role === "assistant") {
      const content = event.message.content;
      const text = Array.isArray(content)
        ? content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join(" ")
        : typeof content === "string"
          ? content
          : "";
      const t = String(text).trim().replace(/\s+/g, " ");
      return t ? `writing: ${t.slice(0, 48)}` : null;
    }
  } catch {
    /* malformed event — no label */
  }
  return null;
}

export interface SpawnResult {
  ok: boolean;
  /** Final assistant text produced by the subagent (capped). */
  output: string;
  error?: string;
  exitCode: number | null;
  durationMs: number;
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter: Record<string, string> = {};
  // Minimal YAML: top-level `key: value` pairs only — enough for agent defs.
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) frontmatter[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { frontmatter, body: content.slice(match[0].length) };
}

/** Discover an agent definition by name from ~/.pi/agent/agents/*.md */
export function discoverAgent(name: string): AgentDef | null {
  const dir = path.join(getAgentDir(), "agents");
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.name.endsWith(".md")) continue;
      const filePath = path.join(dir, entry.name);
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      const { frontmatter, body } = parseFrontmatter(content);
      if (!frontmatter.name || !frontmatter.description) continue;
      if (frontmatter.name !== name) continue;
      return {
        name: frontmatter.name,
        description: frontmatter.description,
        tools: frontmatter.tools?.split(",").map((t) => t.trim()).filter(Boolean),
        model: frontmatter.model,
        systemPrompt: body,
        filePath,
      };
    }
  } catch {
    /* agents dir missing */
  }
  return null;
}

function listAvailableAgents(): string {
  const dir = path.join(getAgentDir(), "agents");
  try {
    const names: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.name.endsWith(".md")) continue;
      try {
        const { frontmatter } = parseFrontmatter(fs.readFileSync(path.join(dir, entry.name), "utf-8"));
        if (frontmatter.name) names.push(frontmatter.name);
      } catch {
        /* ignore */
      }
    }
    return names.join(", ") || "none";
  } catch {
    return "none";
  }
}

function extractFinalOutput(events: any[]): string {
  // Walk backwards for the last assistant message with text content.
  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i];
    if (msg?.role !== "assistant") continue;
    const parts = Array.isArray(msg.content) ? msg.content : [];
    const text = parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

async function writePromptToTempFile(agentName: string, systemPrompt: string): Promise<{ dir: string; filePath: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gstack-pi-agent-"));
  const safeName = agentName.replace(/[^a-z0-9_-]/gi, "_");
  const filePath = path.join(dir, `${safeName}.md`);
  await fs.promises.writeFile(filePath, systemPrompt, "utf-8");
  return { dir, filePath };
}

function resolvePiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }
  return { command: "pi", args };
}

/**
 * Run one subagent task to completion. Never throws — failures come back as
 * `{ ok: false, error }` so workflow phases can degrade gracefully.
 */
export async function runSubagent(req: SpawnRequest): Promise<SpawnResult> {
  const started = Date.now();
  const agent = discoverAgent(req.agent);
  if (!agent) {
    return {
      ok: false,
      output: "",
      error: `Unknown agent "${req.agent}". Available agents: ${listAvailableAgents()}.`,
      exitCode: 1,
      durationMs: 0,
    };
  }

  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);
  if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;
  const collected: any[] = [];
  let stderr = "";

  try {
    if (agent.systemPrompt.trim()) {
      const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPromptPath);
    }
    args.push(`Task: ${req.task}`);

      let aborted = false;
    let timedOut = false;
    const exitCode = await new Promise<number>((resolve) => {
      const invocation = resolvePiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: req.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let buffer = "";
      const processLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line);
          if ((event.type === "message_end" || event.type === "tool_result_end") && event.message) {
            collected.push(event.message);
          }
          const label = activityLabelFromEvent(event);
          if (label) req.onActivity?.(label);
        } catch {
          /* not JSON — ignore */
        }
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timeoutMs = req.timeoutMs ?? defaultTimeoutMs();`n      const timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill("SIGTERM");
          setTimeout(() => proc.kill("SIGKILL"), 5000);
        } catch {
          /* ignore */
        }
      }, timeoutMs);
      timer.unref?.();

      // Cooperative abort: if the parent chain is invalidated (session
      // reload/switch), kill the child promptly instead of letting it run to
      // completion for work nobody will read.
      const abortPoll = setInterval(() => {
        if (req.shouldAbort?.()) {
          aborted = true;
          clearInterval(abortPoll);
          try {
            proc.kill("SIGTERM");
            setTimeout(() => proc.kill("SIGKILL"), 5000);
          } catch {
            /* ignore */
          }
        }
      }, 1000);
      abortPoll.unref?.();

      const finish = (code: number) => {
        clearInterval(abortPoll);
        clearTimeout(timer);
        resolve(code);
      };
      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        finish(aborted ? 130 : code ?? 0);
      });
      proc.on("error", () => finish(1));
    });

    const rawOutput = aborted ? "" : extractFinalOutput(collected);
    if (timedOut) {
      return {
        ok: false,
        output: "",
        error: `Subagent "${req.agent}" timed out after ${Math.round(timeoutMs / 1000)}s (limit configurable via GSTACK_PI_SUBAGENT_TIMEOUT, in seconds).`,
        exitCode,
        durationMs: Date.now() - started,
      };
    }
    const output =
      rawOutput.length > OUTPUT_CAP ? `${rawOutput.slice(0, OUTPUT_CAP)}\n…(truncated)` : rawOutput;

    if (!rawOutput && stderr.trim()) {
      return {
        ok: false,
        output: "",
        error: stderr.trim().slice(0, 2000),
        exitCode,
        durationMs: Date.now() - started,
      };
    }

    return {
      ok: Boolean(rawOutput),
      output,
      error: rawOutput ? undefined : "Subagent produced no output.",
      exitCode,
      durationMs: Date.now() - started,
    };
  } catch (err: any) {
    return { ok: false, output: "", error: err?.message ?? String(err), exitCode: 1, durationMs: Date.now() - started };
  } finally {
    if (tmpPromptPath) {
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch {
        /* ignore */
      }
    }
    if (tmpPromptDir) {
      try {
        fs.rmdirSync(tmpPromptDir);
      } catch {
        /* ignore */
      }
    }
  }
}
