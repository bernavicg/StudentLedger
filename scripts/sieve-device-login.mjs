#!/usr/bin/env node
/**
 * Sieve device login.
 *
 * Runs the device-code flow so a human approves the request in a browser, then
 * stores the returned key as SIEVE_API_KEY in the Convex deployment's secret
 * store (the same place GOOGLE_SERVICE_ACCOUNT_JSON lives).
 *
 * The key is NEVER printed, logged, or written anywhere except the deployment
 * env (or a file you explicitly name with --key-file, at mode 600). The script
 * only ever prints the approval URL and the user code.
 *
 * Usage:
 *   node scripts/sieve-device-login.mjs
 *   node scripts/sieve-device-login.mjs --name "Freebuff" --prod
 *   node scripts/sieve-device-login.mjs --key-file .env.sieve.local
 *
 * If the Convex CLI is not signed in, re-run with --key-file <path> to write
 * the key to a file you control, paste it into the project's Keys tab as
 * SIEVE_API_KEY, then delete the file.
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const BASE = (process.env.SIEVE_BASE_URL || "https://scrape.usesieve.com").replace(
  /\/+$/,
  "",
);
const CLIENT_NAME = value("--name") || "Freebuff";
const KEY_FILE = value("--key-file");
const PROD = flag("--prod");

const log = (message) => process.stderr.write(`${message}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJson(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text === "" ? {} : JSON.parse(text);
  } catch {
    parsed = {};
  }
  return { response, parsed };
}

/** Run the local Convex CLI if it is installed, without needing it on PATH. */
function convexCli() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const localExe = join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "convex.exe" : "convex",
  );
  if (existsSync(localExe)) return { command: localExe, prefix: [] };
  const mainJs = join(projectRoot, "node_modules", "convex", "bin", "main.js");
  if (existsSync(mainJs)) {
    return { command: process.execPath, prefix: [mainJs] };
  }
  return undefined;
}

function storeKey(key) {
  if (KEY_FILE) {
    writeFileSync(KEY_FILE, `SIEVE_API_KEY=${key}\n`, { mode: 0o600 });
    log(`Key written to ${KEY_FILE} (mode 600). Paste it into the Keys tab, then delete the file.`);
    return;
  }

  const cli = convexCli();
  const args = [
    ...(cli ? cli.prefix : []),
    "env",
    "set",
    "SIEVE_API_KEY",
    key,
    ...(PROD ? ["--prod"] : []),
  ];
  const result = cli
    ? spawnSync(cli.command, args, { stdio: ["ignore", "inherit", "inherit"], shell: false })
    : spawnSync("npx", ["convex", ...args], { stdio: ["ignore", "inherit", "inherit"], shell: false });

  if (result.status !== 0) {
    log("Could not set the Convex env var (the CLI is probably not signed in).");
    log("The key was NOT printed. Re-run with --key-file <path> to write it to a");
    log("file, paste it into the project's Keys tab, then delete the file.");
    process.exit(1);
  }
}

async function main() {
  const code = await postJson("/api/auth/device/code", {
    client_name: CLIENT_NAME,
  });
  if (!code.response.ok) {
    log(`Could not start the device login (${code.response.status}).`);
    log("Check that the base URL is reachable, then try again.");
    process.exit(1);
  }

  const device = code.parsed;
  if (!device.device_code || !device.user_code) {
    log("The server did not return a device code.");
    process.exit(1);
  }

  log("");
  log("Approve this login in your browser:");
  log(`  ${device.verification_uri_complete || device.verification_uri}`);
  log("");
  log(`  Check that the code shown matches:  ${device.user_code}`);
  log("");
  log(`  The tool name "${CLIENT_NAME}" is self-reported by the tool, not verified.`);
  log("  Only approve this if YOU started it just now. If you did not, close the tab.");
  log("");

  let interval = Math.max(1, Number(device.interval) || 5);
  const expiresIn = Math.max(30, Number(device.expires_in) || 600);
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const { response, parsed } = await postJson("/api/auth/device/token", {
      device_code: device.device_code,
    });

    if (response.ok && typeof parsed.api_key === "string") {
      storeKey(parsed.api_key);
      log(`Stored SIEVE_API_KEY (${parsed.key_name || "unnamed"}). The key was never printed.`);
      return;
    }

    const error = parsed.error;
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5;
      continue;
    }
    if (error === "access_denied") {
      log("You declined the request. Nothing was stored.");
      process.exit(2);
    }
    if (error === "expired_token") {
      log("The code expired. Run the script again to start over.");
      process.exit(3);
    }
    log(`Unexpected response (${response.status})${error ? `: ${error}` : ""}.`);
    process.exit(1);
  }

  log("The code expired before it was approved. Run the script again.");
  process.exit(3);
}

main().catch((error) => {
  log(`Device login failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
