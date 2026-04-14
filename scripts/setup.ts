#!/usr/bin/env tsx
import prompts from "prompts";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const ENV_PATH = resolve(ROOT, ".env.local");
const EXAMPLE_PATH = resolve(ROOT, ".env.example");

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, "utf8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function writeEnv(path: string, env: Record<string, string>): void {
  const example = existsSync(EXAMPLE_PATH) ? readFileSync(EXAMPLE_PATH, "utf8") : "";
  const keys = [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
  for (const k of Object.keys(env)) if (!keys.includes(k)) keys.push(k);

  let out = "";
  const sections = example.split(/\n(?=# ----)/);
  for (const section of sections) {
    const sectionKeys = [...section.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
    let s = section;
    for (const k of sectionKeys) {
      const v = env[k] ?? "";
      s = s.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`);
    }
    out += s + "\n";
  }
  writeFileSync(path, out.trim() + "\n");
}

function banner(s: string) {
  console.log("\n" + "━".repeat(60));
  console.log("  " + s);
  console.log("━".repeat(60));
}

async function runConvexDev(): Promise<void> {
  console.log("\nLaunching `npx convex dev --once` to configure your deployment.");
  console.log("Convex will open a browser window if you're not logged in.");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("npx", ["convex", "dev", "--once", "--configure", "new"], {
      stdio: "inherit",
      cwd: ROOT,
    });
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`convex dev exited ${code}`)),
    );
  });
}

function hasBinary(name: string): Promise<boolean> {
  return new Promise((ok) => {
    const lookup = process.platform === "win32" ? "where" : "which";
    const child = spawn(lookup, [name], { stdio: "ignore" });
    child.on("exit", (code) => ok(code === 0));
    child.on("error", () => ok(false));
  });
}

function runInherit(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd: ROOT });
    child.on("exit", (code) =>
      code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
    child.on("error", fail);
  });
}

function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"], cwd: ROOT });
    let out = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (code) =>
      code === 0 ? ok(out) : fail(new Error(`${cmd} exited ${code}`)),
    );
    child.on("error", fail);
  });
}

async function sendblueInvoker(): Promise<{ cmd: string; leading: string[] }> {
  if (await hasBinary("sendblue")) return { cmd: "sendblue", leading: [] };
  return { cmd: "npx", leading: ["-y", "@sendblue/cli"] };
}

interface SendblueKeys {
  apiKey?: string;
  apiSecret?: string;
}

function parseSendblueKeys(output: string): SendblueKeys {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const keys: SendblueKeys = {};

  try {
    const json = JSON.parse(clean);
    if (json.api_key_id || json.apiKeyId) keys.apiKey = json.api_key_id ?? json.apiKeyId;
    if (json.api_secret_key || json.apiSecretKey)
      keys.apiSecret = json.api_secret_key ?? json.apiSecretKey;
    if (keys.apiKey && keys.apiSecret) return keys;
  } catch {
    /* not json, fall through to text parsing */
  }

  const idMatch = clean.match(
    /(?:API[- ]?Key[- ]?ID|sb[- ]?api[- ]?key[- ]?id|api_key_id|Key Id)[:\s]+\"?([A-Za-z0-9_-]{16,})/i,
  );
  const secretMatch = clean.match(
    /(?:Secret[- ]?Key|API[- ]?Secret|sb[- ]?api[- ]?secret[- ]?key|api_secret|Secret)[:\s]+\"?([A-Za-z0-9_-]{16,})/i,
  );

  if (idMatch) keys.apiKey = idMatch[1];
  if (secretMatch) keys.apiSecret = secretMatch[1];
  return keys;
}

async function importSendblueFromCli(): Promise<SendblueKeys | null> {
  const { method } = await prompts(
    {
      type: "select",
      name: "method",
      message: "How do you want to configure Sendblue?",
      choices: [
        { title: "Use the Sendblue CLI (I'll run it — fastest)", value: "cli" },
        { title: "Paste my API keys manually", value: "manual" },
        { title: "Skip for now", value: "skip" },
      ],
      initial: 0,
    },
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  if (method === "manual") return null;
  if (method === "skip") return { apiKey: "", apiSecret: "", fromNumber: "" };

  const { account } = await prompts({
    type: "select",
    name: "account",
    message: "Do you already have a Sendblue account?",
    choices: [
      { title: "Yes — log in", value: "login" },
      { title: "No — create one with `sendblue setup`", value: "setup" },
    ],
    initial: 0,
  });

  const { cmd, leading } = await sendblueInvoker();

  banner("Sendblue CLI");
  try {
    await runInherit(cmd, [...leading, account === "setup" ? "setup" : "login"]);
    console.log("\nFetching your Sendblue keys…\n");
    const output = await runCapture(cmd, [...leading, "show-keys"]);
    const parsed = parseSendblueKeys(output);
    if (!parsed.apiKey || !parsed.apiSecret) {
      console.log(
        `\nCouldn't auto-parse keys from the CLI output. I'll ask for them below — copy/paste from the output above.`,
      );
      return null;
    }
    console.log(`\n✓ Pulled your Sendblue keys from the CLI.`);
    return parsed;
  } catch (err) {
    console.log(`\n⚠ Sendblue CLI failed: ${err}`);
    console.log(`Falling back to manual prompts.`);
    return null;
  }
}

async function main() {
  banner("boop-agent setup");

  console.log(`
What this does:
  1. Pulls your Sendblue keys (via their CLI, or you paste them)
  2. Asks about your Claude model preference
  3. Runs \`npx convex dev\` to create a Convex project
  4. Writes .env.local

Before you start:
  • A Claude Code subscription:    https://claude.com/code
  • Convex account (free tier):    https://convex.dev
  • Sendblue (free on agent plan): https://sendblue.co
`);

  const existing = readEnv(ENV_PATH);
  const cli = await importSendblueFromCli();

  const sendblueDefaults = {
    SENDBLUE_API_KEY: cli?.apiKey ?? existing.SENDBLUE_API_KEY ?? "",
    SENDBLUE_API_SECRET: cli?.apiSecret ?? existing.SENDBLUE_API_SECRET ?? "",
  };

  const sendbluePrompts = [] as any[];
  if (!sendblueDefaults.SENDBLUE_API_KEY) {
    sendbluePrompts.push({
      type: "text",
      name: "SENDBLUE_API_KEY",
      message: "Sendblue API key id (sb-api-key-id value)",
      initial: "",
    });
  }
  if (!sendblueDefaults.SENDBLUE_API_SECRET) {
    sendbluePrompts.push({
      type: "password",
      name: "SENDBLUE_API_SECRET",
      message: "Sendblue API secret",
      initial: "",
    });
  }

  const answers = await prompts(
    [
      ...sendbluePrompts,
      {
        type: "select",
        name: "BOOP_MODEL",
        message: "Which Claude model should the agent use?",
        choices: [
          { title: "claude-sonnet-4-6 (recommended)", value: "claude-sonnet-4-6" },
          { title: "claude-opus-4-6 (slowest, most capable)", value: "claude-opus-4-6" },
          { title: "claude-haiku-4-5 (fastest, cheapest)", value: "claude-haiku-4-5" },
        ],
        initial: 0,
      },
      {
        type: "text",
        name: "PORT",
        message: "Local server port",
        initial: existing.PORT ?? "3456",
      },
      {
        type: "confirm",
        name: "runConvex",
        message: "Run `convex dev` now to configure your Convex deployment?",
        initial: true,
      },
    ],
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  // Merge CLI-sourced defaults with what the user answered (answer wins).
  Object.assign(answers, {
    SENDBLUE_API_KEY: answers.SENDBLUE_API_KEY ?? sendblueDefaults.SENDBLUE_API_KEY,
    SENDBLUE_API_SECRET: answers.SENDBLUE_API_SECRET ?? sendblueDefaults.SENDBLUE_API_SECRET,
  });

  const env: Record<string, string> = { ...existing, ...answers };
  delete (env as any).runConvex;
  if (!env.PUBLIC_URL) env.PUBLIC_URL = `http://localhost:${env.PORT ?? "3456"}`;
  // Clear stale / stub Convex values so `convex dev` can populate them freshly.
  // (`convex dev` uses .convex/ to identify the deployment, not these env vars.)
  if (env.CONVEX_URL?.includes("example.convex.cloud")) delete env.CONVEX_URL;
  if (env.VITE_CONVEX_URL?.includes("example.convex.cloud")) delete env.VITE_CONVEX_URL;
  writeEnv(ENV_PATH, env);

  banner("Claude authentication");
  console.log(`This project uses your Claude Code subscription — no Anthropic API key needed.

If you haven't already:
  • Install Claude Code:  npm install -g @anthropic-ai/claude-code
  • Run once:              claude
  • Sign in when prompted

The Claude Agent SDK reads the credentials Claude Code saves on disk.
You can override with ANTHROPIC_API_KEY in .env.local if you'd rather use an API key.
`);

  if (answers.runConvex) {
    await runConvexDev();
    console.log(
      "\nConvex wrote your deployment URL to .env.local. If VITE_CONVEX_URL is missing, copy CONVEX_URL to VITE_CONVEX_URL.",
    );
    const after = readEnv(ENV_PATH);
    if (after.CONVEX_URL && !after.VITE_CONVEX_URL) {
      writeEnv(ENV_PATH, { ...after, VITE_CONVEX_URL: after.CONVEX_URL });
    }
  } else {
    console.log("\nSkipped Convex. Run `npx convex dev` yourself when ready.");
  }

  const port = answers.PORT ?? "3456";
  banner("You're set up. Here's how to actually run it.");
  console.log(`
Before you start: install ngrok (one-time).

  brew install ngrok                           # macOS
  # or download:  https://ngrok.com/download
  ngrok config add-authtoken <your-token>      # free at https://dashboard.ngrok.com

Then run ONE command:

  npm run dev

That starts the server, Convex watcher, debug dashboard, AND ngrok all
together — color-prefixed output so you can tell who's saying what. Once
the tunnel is live, you'll see a banner with your public URL.

Wire up Sendblue (one-time, takes ~30 seconds):

  1. Copy the "Sendblue webhook" URL printed by ngrok.
  2. Sendblue dashboard → API Settings → Webhook Configuration
  3. Add it as an INBOUND MESSAGE webhook.
  4. Paste the URL. Save.

Test it:
  • Open http://localhost:5173 for the debug dashboard (Chat tab works
    without Sendblue).
  • Or text your Sendblue number from a different phone. The agent replies.

Note:
  Replies go out from the Sendblue-provisioned number on your account
  (auto-picked by Sendblue). Text that number from a different phone
  to test.

About PUBLIC_URL in .env.local:
  It defaults to http://localhost:${port} and is only read by the OAuth flow
  (for Google/Slack redirect URIs). If you enable those integrations later,
  paste your ngrok URL into .env.local as PUBLIC_URL and restart.

Integrations:
  All four examples (Gmail, Calendar, Notion, Slack) ship OFF.
  Uncomment them one at a time in server/integrations/registry.ts.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
