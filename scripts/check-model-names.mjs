#!/usr/bin/env node
// Verify that every model name this server sends to kie.ai is one the API
// still accepts. Run after editing src/registry.ts, and whenever a call fails
// with "model name not supported".
//
// It creates no paid job: each probe posts an empty input, so a recognized
// model answers with an input-validation error and an unknown one answers
// "The model name you specified is not supported".
//
// Usage:
//   KIE_API_KEY=... node scripts/check-model-names.mjs
//   node scripts/check-model-names.mjs path/to/.env
//
// Requires a build first (npm run build).
import { readFileSync } from 'node:fs';
import { MODEL_REGISTRY } from '../dist/registry.js';
import { resolveApiModel } from '../dist/types.js';

function readKey() {
  if (process.env.KIE_API_KEY) return process.env.KIE_API_KEY;
  const envPath = process.argv[2];
  if (!envPath) {
    console.error('Set KIE_API_KEY, or pass a path to an .env file as the first argument.');
    process.exit(2);
  }
  const m = readFileSync(envPath, 'utf8').match(/^KIE_API_KEY=(.*)$/m);
  if (!m) {
    console.error(`No KIE_API_KEY line in ${envPath}`);
    process.exit(2);
  }
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const key = readKey();

// Only the unified endpoint sends a model name; the dedicated families
// (veo, runway, suno, gpt4o) ignore it, so probing them proves nothing.
const cases = [];
for (const spec of Object.values(MODEL_REGISTRY)) {
  if (spec.family !== 'unified') continue;
  const plain = resolveApiModel(spec, { prompt: 'x' });
  cases.push({ label: spec.id, apiModel: plain });
  const withImage = resolveApiModel(spec, {
    prompt: 'x',
    image_input: ['https://example.com/a.png'],
  });
  if (withImage !== plain) {
    cases.push({ label: `${spec.id} (image_input)`, apiModel: withImage });
  }
}

let rejected = 0;
for (const { label, apiModel } of cases) {
  let msg = '';
  try {
    const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: apiModel, input: {} }),
    });
    msg = String((await res.json()).msg ?? '');
  } catch (err) {
    console.error(`  ERROR  ${label} -> ${apiModel}: ${err.message}`);
    rejected++;
    continue;
  }
  const unknown = msg.includes('not supported');
  if (unknown) rejected++;
  console.log(`${unknown ? 'REJECTED' : 'accepted'}  ${label.padEnd(28)} -> ${apiModel}`);
}

if (rejected > 0) {
  console.error(`\n${rejected} of ${cases.length} names rejected. Find the current name with:`);
  console.error('  curl -H "Authorization: Bearer $KIE_API_KEY" https://api.kie.ai/api/v1/models');
  console.error('then set apiModel on that entry in src/registry.ts.');
  process.exit(1);
}
console.log(`\nOK: ${cases.length}/${cases.length} names accepted by the API.`);
