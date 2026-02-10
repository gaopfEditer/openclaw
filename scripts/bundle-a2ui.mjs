#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(here, "..");
const HASH_FILE = path.join(ROOT_DIR, "src/canvas-host/a2ui/.bundle.hash");
const OUTPUT_FILE = path.join(ROOT_DIR, "src/canvas-host/a2ui/a2ui.bundle.js");
const A2UI_RENDERER_DIR = path.join(ROOT_DIR, "vendor/a2ui/renderers/lit");
const A2UI_APP_DIR = path.join(ROOT_DIR, "apps/shared/OpenClawKit/Tools/CanvasA2UI");

function onError() {
  console.error("A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle");
  console.error("If this persists, verify pnpm deps and try again.");
  process.exit(1);
}

process.on("uncaughtException", onError);
process.on("unhandledRejection", onError);

// Docker builds exclude vendor/apps via .dockerignore.
// In that environment we must keep the prebuilt bundle.
if (!existsSync(A2UI_RENDERER_DIR) || !existsSync(A2UI_APP_DIR)) {
  console.log("A2UI sources missing; keeping prebuilt bundle.");
  process.exit(0);
}

const INPUT_PATHS = [
  path.join(ROOT_DIR, "package.json"),
  path.join(ROOT_DIR, "pnpm-lock.yaml"),
  A2UI_RENDERER_DIR,
  A2UI_APP_DIR,
];

function normalize(p) {
  return p.split(path.sep).join("/");
}

function walk(entryPath, files = []) {
  const st = statSync(entryPath);
  if (st.isDirectory()) {
    const entries = readdirSync(entryPath);
    for (const entry of entries) {
      walk(path.join(entryPath, entry), files);
    }
    return files;
  }
  files.push(entryPath);
  return files;
}

function computeHash() {
  const files = [];
  for (const input of INPUT_PATHS) {
    walk(input, files);
  }

  files.sort((a, b) => normalize(a).localeCompare(normalize(b)));

  const hash = createHash("sha256");
  for (const filePath of files) {
    const rel = normalize(path.relative(ROOT_DIR, filePath));
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

const currentHash = computeHash();

if (existsSync(HASH_FILE)) {
  const previousHash = readFileSync(HASH_FILE, "utf-8").trim();
  if (previousHash === currentHash && existsSync(OUTPUT_FILE)) {
    console.log("A2UI bundle up to date; skipping.");
    process.exit(0);
  }
}

// Run tsc
const tscResult = spawnSync(
  "pnpm",
  ["-s", "exec", "tsc", "-p", path.join(A2UI_RENDERER_DIR, "tsconfig.json")],
  {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (tscResult.status !== 0) {
  onError();
}

// Run rolldown
const rolldownResult = spawnSync("rolldown", ["-c", path.join(A2UI_APP_DIR, "rolldown.config.mjs")], {
  cwd: ROOT_DIR,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (rolldownResult.status !== 0) {
  onError();
}

// Write hash
writeFileSync(HASH_FILE, currentHash, "utf-8");
