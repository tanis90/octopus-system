// Octopus base-pack retirement guard.
//
// The UGE/octopus content line is retired: no octopus skills or professions
// ship with this system, and the public owner carries only the two core CoC
// packs. This script keeps the old build entry point deterministic by removing
// any stale octopus artifacts and refusing a tree that reintroduces their
// content sources or pack registrations.
//
//   node tools/base-pack/build.mjs
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const RETIRED = ["octopus-skills", "octopus-professions"];
const RETIRED_SOURCES = [
  "content/skills.canonical.json",
  "content/skills.zh-CN.json",
  "content/professions.canonical.json",
  "content/professions.zh-CN.json",
  "content/provenance.json",
  "content/terminology.json",
];

const present = RETIRED_SOURCES.filter((path) => existsSync(join(ROOT, path)));
if (present.length) {
  console.error(`octopus 内容源已废弃但仍存在 ${present.length} 个：${present.join(", ")}`);
  process.exit(1);
}

for (const name of RETIRED) {
  rmSync(join(ROOT, "packs", name), { recursive: true, force: true });
  for (const dir of ["packs-json", "packs-index"]) {
    rmSync(join(ROOT, dir, `${name}.json`), { force: true });
  }
}

const sysPath = join(ROOT, "system.json");
const sys = JSON.parse(readFileSync(sysPath, "utf8"));
const before = sys.packs ?? [];
sys.packs = before.filter((pack) => !RETIRED.includes(pack.name));
const expected = ["coc-skills", "coc-professions"];
const actual = sys.packs.map((pack) => pack.name);
if (actual.length !== expected.length || expected.some((name) => !actual.includes(name))) {
  console.error(`system.json pack 注册必须正好是 ${expected.join(", ")}，实际 ${actual.join(", ")}`);
  process.exit(1);
}
if (sys.packs.length !== before.length) {
  writeFileSync(sysPath, JSON.stringify(sys, null, 2) + "\n");
}

const leftovers = [];
for (const dir of ["packs", "packs-json", "packs-index"]) {
  if (!existsSync(join(ROOT, dir))) continue;
  for (const name of readdirSync(join(ROOT, dir))) {
    if (RETIRED.some((retired) => name === retired || name.startsWith(`${retired}.`))) {
      leftovers.push(`${dir}/${name}`);
    }
  }
}
if (leftovers.length) {
  console.error(`octopus 产物残留 ${leftovers.length} 个：${leftovers.join(", ")}`);
  process.exit(1);
}

console.log("octopus 基础包已退役：内容源缺席，产物与注册已清理");
