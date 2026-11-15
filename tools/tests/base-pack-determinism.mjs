// Octopus base-pack retirement determinism check (no Foundry needed).
//
//   node tools/tests/base-pack-determinism.mjs
//
// The UGE/octopus pack line is retired. Its build entry point is now a
// retirement guard: it removes stale octopus artifacts, refuses reintroduced
// content sources, and leaves the two core CoC packs untouched. This probe
// builds twice in a temp copy and verifies:
//   1. run 1 and run 2 are byte-identical (packs-json / packs-index / packs +
//      system.json);
//   2. run 1 equals the committed artifacts in this repo;
//   3. no octopus content source or pack artifact exists.
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIRS = ["packs-json", "packs-index", "packs"];
const RETIRED = ["octopus-skills", "octopus-professions"];

const walk = (dir, base = dir) => {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(path, base));
    else out.push(relative(base, path));
  }
  return out.sort();
};

const compareTrees = (left, right) => {
  const diffs = [];
  for (const dir of DIRS) {
    const a = join(left, dir), b = join(right, dir);
    if (!existsSync(a) || !existsSync(b)) { diffs.push(`${dir}: missing`); continue; }
    const af = walk(a), bf = walk(b);
    const all = [...new Set([...af, ...bf])].sort();
    for (const rel of all) {
      const pa = join(a, rel), pb = join(b, rel);
      if (!existsSync(pa) || !existsSync(pb)) { diffs.push(`${dir}/${rel}: missing`); continue; }
      if (!readFileSync(pa).equals(readFileSync(pb))) diffs.push(`${dir}/${rel}: bytes differ`);
    }
  }
  return diffs;
};

const leftoverOctopus = () => {
  const leftovers = [];
  for (const dir of DIRS) {
    if (!existsSync(join(ROOT, dir))) continue;
    for (const name of readdirSync(join(ROOT, dir))) {
      if (RETIRED.some((retired) => name === retired || name.startsWith(`${retired}.`))) {
        leftovers.push(`${dir}/${name}`);
      }
    }
  }
  return leftovers;
};

const temp = mkdtempSync(join(tmpdir(), "octopus-pack-determinism-"));
const build = (cwd) => {
  const r = spawnSync(process.execPath, ["tools/base-pack/build.mjs"], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
};

try {
  for (const item of ["content", "tools/base-pack", "system.json", "packs-json", "packs-index", "packs"]) {
    const src = join(ROOT, item);
    if (existsSync(src)) cpSync(src, join(temp, item), { recursive: true });
  }

  build(temp);
  const run1 = join(temp, "__run1");
  for (const dir of DIRS) cpSync(join(temp, dir), join(run1, dir), { recursive: true });
  cpSync(join(temp, "system.json"), join(run1, "system.json"));
  build(temp);

  const consecutive = compareTrees(run1, temp);
  if (!readFileSync(join(run1, "system.json")).equals(readFileSync(join(temp, "system.json")))) {
    consecutive.push("system.json: bytes differ");
  }
  const committed = compareTrees(temp, ROOT);
  if (!readFileSync(join(temp, "system.json")).equals(readFileSync(join(ROOT, "system.json")))) {
    committed.push("system.json: bytes differ");
  }

  const sources = ["content/skills.canonical.json", "content/skills.zh-CN.json",
    "content/professions.canonical.json", "content/professions.zh-CN.json",
    "content/provenance.json", "content/terminology.json"].filter((path) => existsSync(join(ROOT, path)));
  const leftovers = leftoverOctopus();
  const packs = JSON.parse(readFileSync(join(ROOT, "system.json"), "utf8")).packs.map((pack) => pack.name).sort();
  const registrationOk = JSON.stringify(packs) === JSON.stringify(["coc-professions", "coc-skills"]);

  const result = {
    consecutiveByteIdentical: consecutive.length === 0,
    committedArtifactsUnchanged: committed.length === 0,
    octopusSourcesAbsent: sources.length === 0,
    octopusArtifactsAbsent: leftovers.length === 0,
    systemPacksAreCoreOnly: registrationOk,
    consecutiveDiffs: consecutive.slice(0, 8),
    committedDiffs: committed.slice(0, 8),
    octopusSources: sources,
    octopusLeftovers: leftovers,
    packs,
  };
  console.log(JSON.stringify(result, null, 2));
  if (consecutive.length || committed.length || sources.length || leftovers.length || !registrationOk) {
    process.exit(1);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
