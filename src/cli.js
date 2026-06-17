#!/usr/bin/env node
import {
  formatError,
  formatRunSummary,
  resolveTargetAccount,
  runFollowerSync,
  verifyFollower,
  watchDeltaSync,
} from "./syncFollowers.js";

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

try {
  if (command === "resolve-account") {
    const result = await resolveTargetAccount(args);
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "sync") {
    const run = await runFollowerSync(args);
    console.log(formatRunSummary(run));
    console.log(JSON.stringify(run, null, 2));
  } else if (command === "watch") {
    await watchDeltaSync(args);
  } else if (command === "verify") {
    const result = await verifyFollower(args);
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHelp();
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error(formatError(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];

    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }

    const rawKey = item.slice(2);
    const equalsIndex = rawKey.indexOf("=");
    const key = toCamelCase(equalsIndex === -1 ? rawKey : rawKey.slice(0, equalsIndex));
    const inlineValue = equalsIndex === -1 ? null : rawKey.slice(equalsIndex + 1);

    if (inlineValue !== null) {
      parsed[key] = coerceValue(inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = coerceValue(next);
    index += 1;
  }

  return parsed;
}

function coerceValue(value) {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function printHelp() {
  console.log(`Usage:
  node src/cli.js resolve-account --handle renaissxyz
  node src/cli.js sync --mode full --handle renaissxyz
  node src/cli.js sync --mode delta --handle renaissxyz --max-pages 2
  node src/cli.js watch --handle renaissxyz --interval-ms 60000 --max-pages 2
  node src/cli.js verify --handle renaissxyz --follower-id 1234567890

Environment:
  X_BEARER_TOKEN       Required for resolve-account and sync.
  X_FOLLOWER_DATA_DIR  Optional data directory. Defaults to data/x-followers.
`);
}
