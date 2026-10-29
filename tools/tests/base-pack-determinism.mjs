// Base-pack build reproducibility check (no Foundry needed).
//
//   node tools/tests/base-pack-determinism.mjs
//
// Builds twice in a temp copy seeded with the current `packs-json` (so the
// committed per-occurrence ref UUIDs are reused), then verifies:
//   1. run 1 and run 2 are byte-identical (packs-json / packs-index / packs);
//   2. run 1 equals the committed artifacts in this repo (no ID migration).
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIRS = ["packs-json", "packs-index", "packs"];

const walk = (dir, base = dir) => {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(path, base));
    else out.push(relative(base, path));
  }
  return out.sort();
};

// This probe owns the octopus/UGE base pack. Other packs (coc-skills) live in
// the same artifact roots and must not make the base-pack check depend on them.
const isBasePackArtifact = (rel) => rel.startsWith("octopus-");

const compareTrees = (left, right) => {
  const diffs = [];
  for (const dir of DIRS) {
    const a = join(left, dir), b = join(right, dir);
    if (!existsSync(a) || !existsSync(b)) { diffs.push(`${dir}: missing`); continue; }
    const af = walk(a).filter(isBasePackArtifact), bf = walk(b).filter(isBasePackArtifact);
    const all = [...new Set([...af, ...bf])].sort();
    for (const rel of all) {
      const pa = join(a, rel), pb = join(b, rel);
      if (!existsSync(pa) || !existsSync(pb)) { diffs.push(`${dir}/${rel}: missing`); continue; }
      if (!readFileSync(pa).equals(readFileSync(pb))) diffs.push(`${dir}/${rel}: bytes differ`);
    }
  }
  return diffs;
};

const temp = mkdtempSync(join(tmpdir(), "octopus-pack-determinism-"));
const build = () => {
  const r = spawnSync(process.execPath, ["tools/base-pack/build.mjs"], { cwd: temp, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
};

try {
  for (const item of ["content", "tools/base-pack", "system.json", "packs-json"]) {
    const src = join(ROOT, item);
    if (!existsSync(src)) throw new Error(`missing seed: ${item}`);
    cpSync(src, join(temp, item), { recursive: true });
  }

  build();
  const run1 = join(temp, "__run1");
  for (const dir of DIRS) cpSync(join(temp, dir), join(run1, dir), { recursive: true });
  build();

  const consecutive = compareTrees(run1, temp);
  const committed = existsSync(join(ROOT, "packs"))
    ? compareTrees(temp, ROOT)
    : [];
  const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const result = {
    consecutiveByteIdentical: consecutive.length === 0,
    committedArtifactsUnchanged: committed.length === 0,
    professionJsonSha256: hash(join(temp, "packs-json/octopus-professions.json")),
    consecutiveDiffs: consecutive.slice(0, 8),
    committedDiffs: committed.slice(0, 8),
  };
  console.log(JSON.stringify(result, null, 2));
  if (consecutive.length || committed.length) process.exit(1);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
