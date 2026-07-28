/**
 * scripts/gen-tools.ts — Offline tool generator for gstack-pi (PLAN §10).
 *
 * Consumes:
 *   - gstack/browse/src/commands.ts (via regex parsing of COMMAND_DESCRIPTIONS keys/values)
 *   - gstack-pi/lib/schemas.ts (for typed parameter definitions)
 *
 * Produces:
 *   - gstack-pi/tools.generated.ts (registerTool calls, execute dispatch, buildArgs map)
 *   - gstack-pi/lib/commands.generated.ts (allowlist ReadonlySet)
 *
 * Safety checks executed:
 *   1. Missing included command (error).
 *   2. Orphan schema for excluded/removed command (warning).
 *   3. Breaking flag removal/rename (warning if schema field has no matches in CLI usage).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const gstackRoot = process.env.GSTACK_REPO || resolve(here, "..", "source");
const gstackPiRoot = resolve(here, "..");

// Final inclusion set (PLAN §2 & §3 updated) — kebab-case (matching gstack command name)
const INCLUDE = [
  "goto", "back", "forward", "reload", "url", "load-html",
  "snapshot",
  "text", "html", "links", "forms", "accessibility", "media",
  "console", "network", "cookies", "storage",
  "js", "eval", "css", "attrs", "is", "inspect", "ux-audit",
  "click", "fill", "select", "hover", "type", "press", "scroll", "wait",
  "upload", "viewport", "style", "cleanup", "cookie", "cookie-import", "cookie-import-browser",
  "header", "useragent", "dialog-accept", "dialog-dismiss",
  "screenshot", "pdf", "responsive", "diff", "prettyscreenshot",
  "download", "scrape", "archive",
  "tabs", "tab", "newtab", "closetab", "frame", "state", "skill",
  "handoff", "resume",
];

// Helper to convert kebab-case to snake_case (e.g. load-html -> load_html)
function toSnake(s: string): string {
  return s.replace(/-/g, "_");
}

function main() {
  const commandsTsPath = join(gstackRoot, "browse", "src", "commands.ts");
  if (!existsSync(commandsTsPath)) {
    console.error(`Error: Cannot find gstack commands.ts at ${commandsTsPath}`);
    process.exit(1);
  }

  const src = readFileSync(commandsTsPath, "utf8");

  // Extract keys and metadata from COMMAND_DESCRIPTIONS
  const start = src.indexOf("COMMAND_DESCRIPTIONS:");
  const eqIndex = src.indexOf("=", start);
  const braceOpen = src.indexOf("{", eqIndex);
  let depth = 0;
  let end = -1;
  for (let i = braceOpen; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(braceOpen, end + 1);

  // Match key: { category: 'cat', description: 'desc', usage?: 'usage' }
  const entryRe = /^\s*['"]([^'"]+)['"]\s*:\s*\{\s*category:\s*['"]([^'"]*)['"]\s*,\s*description:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")(?:\s*,\s*usage:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"))?/gm;

  const gstackCommands: Record<string, { category: string; description: string; usage?: string }> = {};
  let m;
  while ((m = entryRe.exec(body))) {
    const key = m[1];
    const cat = m[2];
    const desc = unesc(m[3]);
    const usage = m[4] ? unesc(m[4]) : undefined;
    gstackCommands[key] = { category: cat, description: desc, usage };
  }

  // Parse schema metadata from schemas.ts to run build-time checks
  const schemasTsPath = join(gstackPiRoot, "lib", "schemas.ts");
  const schemasSrc = readFileSync(schemasTsPath, "utf8");

  // Check 1: Missing included command (error)
  for (const cmd of INCLUDE) {
    if (!gstackCommands[cmd]) {
      console.error(`FATAL ERROR: Included command '${cmd}' is missing from gstack COMMAND_DESCRIPTIONS!`);
      process.exit(1);
    }
  }

  // Check 2: Orphan schema for excluded/removed command (warning)
  // Extract keys declared in SCHEMA_FOR
  const schemaKeysMatch = schemasSrc.match(/const S = \{([\s\S]*?)\n\};/);
  const schemaKeys = new Set<string>();
  if (schemaKeysMatch) {
    const keysRe = /^  ([a-zA-Z0-9_]+)\s*:/gm;
    let sk;
    while ((sk = keysRe.exec(schemaKeysMatch[1]))) {
      schemaKeys.add(sk[1]);
    }
  }

  for (const sk of schemaKeys) {
    // Map snake_case schema key back to kebab-case
    const kebabKey = sk.replace(/_/g, "-");
    if (!INCLUDE.includes(kebabKey)) {
      console.warn(`WARNING: Orphan schema key '${sk}' found in schemas.ts. Command '${kebabKey}' is not in the INCLUDE filter.`);
    }
  }

  // Check 3: Breaking flag rename/remove (warning if schema field has no match in CLI usage/description)
  // We inspect SCHEMA_FOR declarations via regex to find typed fields per key
  if (schemaKeysMatch) {
    const block = schemaKeysMatch[1];
    // Split block into individual command definitions
    const sections = block.split(/^\s*([a-zA-Z0-9_]+)\s*:\s*Type\.Object\(\{/gm);
    // index 0 is preamble, then pairs: [name, body]
    for (let i = 1; i < sections.length; i += 2) {
      const sName = sections[i];
      const sBody = sections[i + 1];
      const kebab = sName.replace(/_/g, "-");
      const cmdMeta = gstackCommands[kebab];
      if (!cmdMeta) continue;

      const fields = [...sBody.matchAll(/^\s*([a-zA-Z0-9_]+)\s*:/gm)].map(x => x[1]);
      const usageText = ((cmdMeta.usage ?? "") + " " + cmdMeta.description).toLowerCase();

      for (const f of fields) {
        if (["extraArgs", "timeoutMs", "ref", "selector", "path", "file", "url", "url1", "url2", "id", "name", "value", "expr", "prop", "action"].includes(f)) {
          continue; // skip common structural / positional fields
        }
        // Map field camel/snake -> kebab flag (e.g. cursorInteractive -> cursor-interactive, depth -> depth)
        const flagKebab = f.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        // Check if --flag, -flag, or short flag (single char) exists in usage/description
        const hasFlag = usageText.includes(`-${flagKebab}`) ||
                        usageText.includes(`--${flagKebab}`) ||
                        (flagKebab.length === 1 && usageText.includes(`-${flagKebab}`)) ||
                        // special cases
                        (flagKebab === "networkidle" && usageText.includes("networkidle")) ||
                        (flagKebab === "load" && usageText.includes("load")) ||
                        (flagKebab === "images" && usageText.includes("images")) ||
                        (flagKebab === "videos" && usageText.includes("videos")) ||
                        (flagKebab === "audio" && usageText.includes("audio"));

        if (!hasFlag) {
          console.warn(`WARNING: Schema flag '${f}' (mapped to '-[--]${flagKebab}') on command '${kebab}' does not match any flag mentioned in usage or description: "${cmdMeta.usage ?? cmdMeta.description}"`);
        }
      }
    }
  }

  // Generate 1: lib/commands.generated.ts
  const allowedSetBody = INCLUDE.map(k => `  "${k}",`).join("\n");
  const commandsGeneratedSrc = `// AUTO-GENERATED by scripts/gen-tools.ts — do not edit. Regenerate via \`bun run gen:tools\`.
// Source: gstack/browse/src/commands.ts COMMAND_DESCRIPTIONS keys ∩ INCLUDE filter.

export const GSTACK_COMMANDS = [
${INCLUDE.map(k => `  "${k}",`).join("\n")}
];

export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set(GSTACK_COMMANDS);
`;
  writeFileSync(join(gstackPiRoot, "lib", "commands.generated.ts"), commandsGeneratedSrc, "utf8");

  // Generate 2: tools.generated.ts
  let toolsBody = "";
  for (const cmd of INCLUDE) {
    const meta = gstackCommands[cmd];
    const snake = toSnake(cmd);
    const hasSchema = schemaKeys.has(snake);
    const schemaRef = hasSchema ? `SCHEMA_FOR.${snake}` : "BARE_SCHEMA";

    // Format tool name: prefix with gstack_
    const toolName = `gstack_${snake}`;
    const label = cmd.charAt(0).toUpperCase() + cmd.slice(1).replace(/-/g, " ");

    toolsBody += `  {
    name: "${toolName}",
    gstackCmd: "${cmd}",
    label: "${label}",
    description: ${JSON.stringify(meta.description)},
    schema: ${schemaRef},
  },
`;
  }

  const toolsGeneratedSrc = `// AUTO-GENERATED by scripts/gen-tools.ts — do not edit. Regenerate via \`bun run gen:tools\`.
import { Type } from "typebox"; // peerDep resolved via pi loader
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runBrowse, cap, classifyError } from "./lib/browse";
import { isAllowed } from "./lib/commands";
import { SCHEMA_FOR, BARE_SCHEMA } from "./lib/schemas";

const TOOLS = [
${toolsBody}];

/** Build CLI arg array from LLM-supplied typed params. Positional/flag mapping. */
export function buildArgs(cmd: string, params: any): string[] {
  const args: string[] = [];

  // Positional helpers
  const target = params.selector ?? params.ref;

  switch (cmd) {
    case "goto":
      args.push(params.url);
      break;

    case "load-html":
      if (params.file) args.push(params.file);
      if (params.waitUntil) {
        args.push("--wait-until", params.waitUntil);
      }
      if (params.tabIndex !== undefined) {
        args.push("--tab-id", String(params.tabIndex));
      }
      break;

    case "click":
    case "hover":
    case "links":
    case "forms":
    case "accessibility":
      if (target) args.push(target);
      break;

    case "fill":
      if (target) args.push(target);
      args.push(params.value);
      break;

    case "select":
      if (target) args.push(target);
      args.push(params.value);
      break;

    case "type":
      args.push(params.text);
      break;

    case "press":
      args.push(params.key);
      break;

    case "scroll":
      if (target) args.push(target);
      break;

    case "wait":
      if (params.selector) args.push(params.selector);
      else if (params.networkidle) args.push("--networkidle");
      else if (params.load) args.push("--load");
      break;

    case "upload":
      if (target) args.push(target);
      if (params.files) args.push(...params.files);
      break;

    case "viewport":
      if (params.size) args.push(params.size);
      if (params.scale !== undefined) args.push("--scale", String(params.scale));
      break;

    case "cookie":
      args.push(params.nameValue);
      break;

    case "cookie-import":
      args.push(params.json);
      break;

    case "cookie-import-browser":
      if (params.browser) args.push(params.browser);
      if (params.domain) args.push("--domain", params.domain);
      break;

    case "header":
      args.push(params.nameValue);
      break;

    case "useragent":
      args.push(params.string);
      break;

    case "dialog-accept":
      if (params.text) args.push(params.text);
      break;

    case "text":
    case "html":
      if (params.selector) args.push(params.selector);
      break;

    case "media":
      if (params.images) args.push("--images");
      if (params.videos) args.push("--videos");
      if (params.audio) args.push("--audio");
      if (params.selector) args.push(params.selector);
      break;

    case "js":
      args.push(params.expr);
      if (params.out) args.push("--out", params.out);
      if (params.raw) args.push("--raw");
      break;

    case "eval":
      args.push(params.file);
      if (params.out) args.push("--out", params.out);
      if (params.raw) args.push("--raw");
      break;

    case "css":
      args.push(params.selector, params.prop);
      break;

    case "attrs":
      if (target) args.push(target);
      break;

    case "is":
      args.push(params.prop);
      if (target) args.push(target);
      break;

    case "console":
      if (params.clear) args.push("--clear");
      if (params.errors) args.push("--errors");
      break;

    case "network":
      if (params.clear) args.push("--clear");
      break;

    case "storage":
      if (params.setKey && params.setValue !== undefined) {
        args.push("set", params.setKey, params.setValue);
      }
      break;

    case "style":
      if (params.undo) {
        args.push("--undo");
        if (params.undoN !== undefined) args.push(String(params.undoN));
      } else {
        if (target) args.push(target);
        args.push(params.prop, params.value);
      }
      break;

    case "cleanup":
      if (params.ads) args.push("--ads");
      if (params.cookies) args.push("--cookies");
      if (params.sticky) args.push("--sticky");
      if (params.social) args.push("--social");
      if (params.all) args.push("--all");
      break;

    case "snapshot":
      if (params.interactive) args.push("-i");
      if (params.compact) args.push("-c");
      if (params.depth !== undefined) args.push("-d", String(params.depth));
      if (params.selector) args.push("-s", params.selector);
      if (params.diff) args.push("-D");
      if (params.annotate) args.push("-a");
      if (params.outputPath) args.push("-o", params.outputPath);
      if (params.cursorInteractive) args.push("-C");
      if (params.heatmap) args.push("-H", params.heatmap);
      break;

    case "screenshot":
      if (params.viewport) args.push("--viewport");
      if (params.clip) args.push("--clip", params.clip);
      if (params.base64) args.push("--base64");
      // screenshot usage allows selector and output path as positionals
      if (target) args.push(target);
      if (params.path) args.push(params.path);
      break;

    case "pdf":
      if (params.path) args.push(params.path);
      if (params.format) args.push("--format", params.format);
      if (params.width) args.push("--width", params.width);
      if (params.height) args.push("--height", params.height);
      if (params.margins) args.push("--margins", params.margins);
      if (params.pageNumbers) args.push("--page-numbers");
      if (params.tagged) args.push("--tagged");
      if (params.outline) args.push("--outline");
      if (params.printBackground) args.push("--print-background");
      if (params.tabIndex !== undefined) {
        args.push("--tab-id", String(params.tabIndex));
      }
      break;

    case "responsive":
      if (params.prefix) args.push(params.prefix);
      break;

    case "diff":
      args.push(params.url1, params.url2);
      break;

    case "download":
      if (target) args.push(target);
      if (params.path) args.push(params.path);
      if (params.base64) args.push("--base64");
      if (params.navigate) args.push("--navigate");
      break;

    case "scrape":
      args.push(params.kind);
      if (params.selector) args.push("--selector", params.selector);
      if (params.dir) args.push("--dir", params.dir);
      if (params.limit !== undefined) args.push("--limit", String(params.limit));
      break;

    case "archive":
      if (params.path) args.push(params.path);
      break;

    case "tab":
      args.push(String(params.id));
      break;

    case "newtab":
      if (params.url) args.push(params.url);
      if (params.json) args.push("--json");
      break;

    case "closetab":
      if (params.id !== undefined) args.push(String(params.id));
      break;

    case "frame":
      if (params.main) {
        args.push("main");
      } else {
        if (params.name) args.push("--name", params.name);
        else if (params.url) args.push("--url", params.url);
        else if (target) args.push(target);
      }
      break;

    case "state":
      args.push(params.action, params.name);
      break;

    case "skill":
      args.push(params.action);
      if (params.name) args.push(params.name);
      if (params.arg) {
        for (const kv of params.arg) args.push("--arg", kv);
      }
      if (params.timeoutSec !== undefined) {
        args.push(\`--timeout=\${params.timeoutSec}s\`);
      }
      break;

    case "prettyscreenshot":
      if (params.scrollTo) args.push("--scroll-to", params.scrollTo);
      if (params.cleanup) args.push("--cleanup");
      if (params.hide) {
        for (const s of params.hide) args.push("--hide", s);
      }
      if (params.width !== undefined) args.push("--width", String(params.width));
      if (params.path) args.push(params.path);
      break;

    case "handoff":
      if (params.message) args.push(params.message);
      break;
  }

  // Fallback / Append rare/extra flags verbatim if supplied.
  if (params.extraArgs) {
    args.push(...params.extraArgs);
  }

  return args;
}

export function registerGstackTools(pi: ExtensionAPI) {
  for (const t of TOOLS) {
    pi.registerTool({
      name: t.name,
      label: t.label,
      description: t.description,
      parameters: t.schema,
      async execute(toolCallId, params: any, signal, onUpdate, ctx) {
        if (!isAllowed(t.gstackCmd)) {
          return {
            isError: true,
            content: [{ type: "text", text: \`unknown command: \${t.gstackCmd}\` }],
            details: {},
          };
        }

        // Validate targets: click, fill, select, hover, links, forms, accessibility, attrs, is, upload, screenshot, download, frame, prettyscreenshot, style
        // exactly one of ref or selector required if both declared.
        // We do this check only if the schema allows both fields.
        const declaresTgt = ("ref" in params || "selector" in params) &&
          !["text", "html", "media", "wait", "snapshot", "scrape"].includes(t.gstackCmd); // exclusion exceptions

        if (declaresTgt) {
          const hasRef = params.ref !== undefined && params.ref !== "";
          const hasSel = params.selector !== undefined && params.selector !== "";
          if (hasRef && hasSel) {
            return {
              isError: true,
              content: [{ type: "text", text: "Error: Both 'ref' and 'selector' supplied. Provide exactly one target." }],
              details: {},
            };
          }
          if (!hasRef && !hasSel) {
            // Wait, screenshot allow empty target (meaning full page). Others require it.
            const optionalTgt = ["screenshot", "download", "prettyscreenshot"].includes(t.gstackCmd);
            if (!optionalTgt) {
              return {
                isError: true,
                content: [{ type: "text", text: "Error: Target required. Provide either 'ref' or 'selector'." }],
                details: {},
              };
            }
          }
        }

        // Gate: cookie-import-browser needs UI confirmation to prevent silent credential theft
        if (t.gstackCmd === "cookie-import-browser") {
          const domainInfo = params.domain ? \` for domain "\${params.domain}"\` : "";
          const ok = await ctx.ui.confirm(
            "Cookie Import Confirmation",
            \`Allow gstack to read local browser cookies\${domainInfo}? This can leak your credentials.\`
          );
          if (!ok) {
            return {
              isError: true,
              content: [{ type: "text", text: "gstack cookie-import-browser blocked by user confirmation." }],
              details: {},
            };
          }
        }

        const builtArgs = buildArgs(t.gstackCmd, params);
        const { stdout, stderr, code } = await runBrowse(t.gstackCmd, builtArgs, {
          signal,
          timeoutMs: params.timeoutMs,
        });

        if (code !== 0) {
          const msg = classifyError(stderr, builtArgs);
          return {
            isError: true,
            content: [{ type: "text", text: \`gstack \${t.gstackCmd} (exit \${code}):\\n\${msg}\` }],
            details: { code, rawStderr: stderr },
          };
        }

        const { body } = cap(stdout, params);
        return {
          content: [{ type: "text", text: body }],
          details: { code },
        };
      },
    });
  }
}
`;
  writeFileSync(join(gstackPiRoot, "tools.generated.ts"), toolsGeneratedSrc, "utf8");

  console.log("Successfully generated tools.generated.ts and lib/commands.generated.ts!");
}

function unesc(s: string): string {
  const q = s[0];
  let inner = s.slice(1, s.length - 1);
  if (q === "'") {
    inner = inner.replace(/\\'/g, "'");
  } else {
    inner = inner.replace(/\\"/g, '"');
  }
  inner = inner.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  return inner;
}

main();
