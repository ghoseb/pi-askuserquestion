#!/usr/bin/env node
// Cut a release: bump version, regenerate CHANGELOG.md, commit, and tag.
//
// Usage: pnpm release [patch|minor|major|<x.y.z>]
//   No argument: git-cliff infers the bump from conventional commits.
//
// Does NOT push or publish. Follow up with:
//   git push --follow-tags && npm publish

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SEMVER = /^\d+\.\d+\.\d+$/;
const BUMPS = new Set(["patch", "minor", "major"]);
const RELEASE_BRANCH = "main";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "inherit"],
  })?.trim();
}

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function currentVersion() {
  return JSON.parse(readFileSync("package.json", "utf8")).version;
}

function bumpSemver(version, kind) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function resolveVersion(arg, current) {
  if (arg === undefined) {
    const bumped = run("git-cliff", ["--bumped-version"]);
    return bumped.replace(/^v/, "");
  }
  if (BUMPS.has(arg)) return bumpSemver(current, arg);
  if (SEMVER.test(arg)) return arg;
  return fail(`invalid version "${arg}" (expected patch|minor|major|x.y.z)`);
}

// ── Preconditions ────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (run("git", ["status", "--porcelain"]) !== "") {
  fail("working tree is not clean; commit or stash first");
}
const branch = run("git", ["branch", "--show-current"]);
if (branch !== RELEASE_BRANCH) {
  fail(`must release from "${RELEASE_BRANCH}" (on "${branch}")`);
}

const current = currentVersion();
const next = resolveVersion(arg, current);
const tag = `v${next}`;

if (run("git", ["tag", "--list", tag]) !== "") {
  fail(`tag ${tag} already exists`);
}

console.log(`release: ${current} -> ${next}`);

// ── Verify ───────────────────────────────────────────────────────────────────

run("pnpm", ["check"], { inherit: true });
run("pnpm", ["test"], { inherit: true });

// ── Bump, changelog, commit, tag ─────────────────────────────────────────────

run("npm", ["version", next, "--no-git-tag-version", "--allow-same-version"]);
run("git-cliff", ["--tag", tag, "--output", "CHANGELOG.md"], {
  inherit: true,
});
run("git", ["add", "package.json", "CHANGELOG.md"]);
run("git", ["commit", "-m", `chore(release): ${tag}`]);
run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);

console.log(`
release: created commit and tag ${tag}
Next:
  git push --follow-tags
  npm publish
`);
