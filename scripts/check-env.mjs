#!/usr/bin/env node
// Reports whether the two Supabase environment variables are set, and with
// --require exits non-zero when either is missing.
//
// This is a deploy-time guard, not a runtime check. The app itself is meant to
// fall back to demo mode when the variables are absent — see src/supabaseClient.js.
// Nothing here changes that.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEYS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `Usage: node scripts/check-env.mjs [--require] [--help]

Reports whether ${KEYS.join(" and ")} are set,
either in the environment or in a .env file in the project root.

  (no flags)  Print the result and exit 0, whatever it is.
  --require   Exit 1 if either variable is missing.
  --help      This text.

What it is for
  Without the two variables the build still succeeds: the Supabase client is
  tree-shaken out of the bundle and the app runs in demo mode, in memory, saving
  nothing. That is deliberate — it is how the app runs locally and how the test
  suite runs — but it is not what you want on a deployed URL, where it looks
  identical to a working app right up until someone reloads the page.

  So this is a deploy-time guard you put in front of a production build with
  --require. It does not change how the app behaves at runtime, and it does not
  make a missing variable an error anywhere else.`;

// A deliberately plain .env reader: KEY=value, one per line, # for comments,
// optional surrounding quotes. Enough for the two keys this project uses.
function readDotEnv() {
  let text;
  try {
    text = readFileSync(join(projectRoot, ".env"), "utf8");
  } catch {
    return {};
  }

  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const required = argv.includes("--require");
const dotEnv = readDotEnv();

const results = KEYS.map((key) => {
  const fromProcess = process.env[key];
  if (fromProcess) return { key, present: true, source: "environment" };

  const fromFile = dotEnv[key];
  if (fromFile) return { key, present: true, source: ".env" };

  return { key, present: false, source: null };
});

const width = Math.max(...KEYS.map((key) => key.length));
const missing = results.filter((result) => !result.present);

console.log("Supabase environment check\n");
for (const { key, present, source } of results) {
  console.log(`  ${key.padEnd(width)}  ${present ? `set (${source})` : "missing"}`);
}
console.log("");

if (missing.length === 0) {
  console.log("Supabase-backed: a build from this environment will sign users in and save their data.");
  process.exit(0);
}

console.log("Demo mode: a build from this environment leaves the Supabase client out of the");
console.log("bundle entirely. The app will work, sign nobody in, and save nothing anywhere.");
console.log("That is fine locally and for the tests; on a deployed URL it is almost certainly not.");

if (required) {
  console.error(`\nRefusing to continue: ${missing.map((result) => result.key).join(", ")} not set (--require).`);
  process.exit(1);
}

console.log("\nRun with --require to make this a failure instead of a note.");
process.exit(0);
