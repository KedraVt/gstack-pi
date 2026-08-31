#!/usr/bin/env node
// upsert.mjs — safely add/merge a model into pi's models.json.
//
// Usage:
//   node upsert.mjs [--path <file>] --json '<payload>'
//   node upsert.mjs [--path <file>] --file <payload.json>
//   cat payload.json | node upsert.mjs [--path <file>]
//   node upsert.mjs --path <file> --dry-inspect        # print current providers/models
//
// Payload shape:
//   {
//     "provider": "agnes",                 // required: provider key (new or existing)
//     "providerConfig": { ... },           // optional: baseUrl / api / apiKey / headers / compat
//     "model": { "id": "..." , ... }       // required: at least "id"
//   }
//
// Semantics:
//   - Existing provider  -> merge providerConfig (only provided keys) + upsert model by id.
//   - New provider       -> create it with providerConfig + models:[model].
//   - Unrelated providers/keys are preserved. Output is pretty-printed (2-space indent).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const DEFAULT_PATH = join(homedir(), '.pi', 'agent', 'models.json');

function fail(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { json: null, file: null, path: DEFAULT_PATH, inspect: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = argv[++i];
    else if (a === '--file') opts.file = argv[++i];
    else if (a === '--path') opts.path = argv[++i];
    else if (a === '--dry-inspect') opts.inspect = true;
    else fail(`Unknown argument: ${a}`);
  }
  return opts;
}

function loadPayload(opts) {
  if (opts.file) return JSON.parse(readFileSync(opts.file, 'utf8'));
  if (opts.json) return JSON.parse(opts.json);
  // fall back to stdin
  try {
    const data = readFileSync(0, 'utf8');
    if (!data.trim()) fail('No payload provided (use --json, --file, or pipe stdin).');
    return JSON.parse(data);
  } catch (e) {
    fail(`Could not read payload from stdin: ${e.message}`);
  }
}

function inspect(path) {
  if (!existsSync(path)) {
    console.log(`(no file at ${path} — would be created)`);
    return;
  }
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const providers = config.providers || {};
  console.log(`File: ${path}`);
  for (const [name, p] of Object.entries(providers)) {
    const models = (p.models || []).map((m) => m.id).join(', ') || '(none)';
    console.log(`- provider "${name}" [api=${p.api || '—'}, baseUrl=${p.baseUrl || '—'}] models: ${models}`);
  }
}

function mergeModel(existing, incoming) {
  // New values win; keep unspecified existing keys.
  return { ...existing, ...incoming };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.inspect) {
    inspect(opts.path);
    return;
  }

  const payload = loadPayload(opts);
  const providerName = payload.provider;
  if (!providerName) fail('Missing "provider" name in payload.');
  const model = payload.model;
  if (!model || !model.id) fail('Missing "model.id" in payload.');

  let config = { providers: {} };
  if (existsSync(opts.path)) {
    try {
      config = JSON.parse(readFileSync(opts.path, 'utf8'));
    } catch (e) {
      fail(`Existing file is not valid JSON (${e.message}). Aborting to avoid data loss.`);
    }
  }
  if (!config.providers) config.providers = {};

  const providers = config.providers;
  const existing = providers[providerName];

  if (existing) {
    if (payload.providerConfig) {
      for (const [k, v] of Object.entries(payload.providerConfig)) {
        if (v !== undefined) existing[k] = v;
      }
    }
    if (!existing.models) existing.models = [];
    const idx = existing.models.findIndex((m) => m.id === model.id);
    if (idx >= 0) {
      existing.models[idx] = mergeModel(existing.models[idx], model);
    } else {
      existing.models.push(model);
    }
  } else {
    const np = { ...(payload.providerConfig || {}) };
    np.models = [model];
    providers[providerName] = np;
  }

  const dir = dirname(opts.path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(opts.path, JSON.stringify(config, null, 2) + '\n', 'utf8');

  console.log(
    `OK: model "${model.id}" ${existing ? 'upserted into' : 'added to new provider'} "${providerName}" -> ${opts.path}`
  );
}

main();
