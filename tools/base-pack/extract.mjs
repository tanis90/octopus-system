// 基础包提取器（docs/base-pack.md §3）：从 brpugesrd 的 UGE ORC markdown 提取
// 技能与职业 → content/*.canonical.json（en，带 sourceLocator）。
// 用法：node tools/base-pack/extract.mjs [brpugesrd仓路径，默认 ../.tmp/brpugesrd]
// 提取规则与源 commit 的对应关系见 content/provenance.json（本脚本一并写出）。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../..");
const SRC = process.argv[2] ?? join(REPO_ROOT, "../.tmp/brpugesrd");
const OUT_DIR = join(REPO_ROOT, "content");

const SKILLS_MD = join(SRC, "rules/en/0300_Skills.md");
const CHARS_MD = join(SRC, "rules/en/0200_Characters.md");
let sourceCommit = "unknown";
try {
  sourceCommit = execFileSync("git", ["-C", SRC, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
} catch { /* 离线重跑：保留上次 provenance */ }

const slugify = (s) => s.toLowerCase()
  .replace(/\(various\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function extractSkills(md) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## Skill Descriptions"));
  const skills = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    const h = l.match(/^### (.+)$/);
    if (h) {
      if (cur) skills.push(cur);
      cur = { name: h[1].trim(), slug: slugify(h[1]), line: i + 1, base: null, baseRaw: "", category: "", description: "" };
      continue;
    }
    if (!cur) continue;
    const base = l.match(/^\*\*Base Chance:\*\*\s*(.+)$/);
    if (base) { cur.baseRaw = base[1].trim(); cur.base = parseInt(base[1], 10) || null; continue; }
    const cat = l.match(/^\*\*Category:\*\*\s*(.+)$/);
    if (cat) { cur.category = cat[1].trim(); continue; }
    // 描述 = Category 行之后到下一个加粗字段/标题前的第一段散文
    if (cur.category && !l.startsWith("**") && !l.startsWith("#") && l.trim() && !cur.description) {
      cur.description = l.trim();
    }
  }
  if (cur) skills.push(cur);
  return skills.filter((s) => s.name && !s.name.startsWith("Skill"));
}

function extractProfessions(md) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "#### Artist");
  const end = lines.findIndex((l, idx) => idx > start && /^### (?!$)/.test(l) && !/^#### /.test(l) && idx > start && lines.slice(start, idx).some(x => x.startsWith("####")) && /^###\s[A-Z]/.test(l) && idx > start + 10);
  const professions = [];
  let cur = null;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    const h = l.match(/^#### (.+)$/);
    if (h) {
      if (cur) professions.push(cur);
      cur = { name: h[1].trim(), slug: slugify(h[1]), line: i + 1, description: "", wealth: "", skills: "" };
      continue;
    }
    if (!cur) continue;
    if (/^### /.test(l)) break; // 离开职业区
    const w = l.match(/^\*\*Wealth:?\*\*:?\s*(.+)$/i);
    if (w) { cur.wealth = w[1].trim(); continue; }
    const s = l.match(/^\*\*Skills:?\*\*:?\s*(.+)$/i);
    if (s) { cur.skills = s[1].trim(); continue; }
    if (!l.startsWith("**") && l.trim() && !cur.description && !cur.wealth && !cur.skills) {
      cur.description = l.trim();
    }
  }
  if (cur) professions.push(cur);
  return professions;
}

const skills = extractSkills(readFileSync(SKILLS_MD, "utf8"));
const professions = extractProfessions(readFileSync(CHARS_MD, "utf8"));

const withLoc = (arr, file) => arr.map(({ line, ...rest }) => ({ ...rest, sourceLocator: { file, line } }));
const outSkills = withLoc(skills, "rules/en/0300_Skills.md");
const outProfs = withLoc(professions, "rules/en/0200_Characters.md");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "skills.canonical.json"), JSON.stringify(outSkills, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "professions.canonical.json"), JSON.stringify(outProfs, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "provenance.json"), JSON.stringify({
  source: "https://github.com/raleel/brpugesrd",
  license: "ORC (BRP:UGE ORC Content Document, Chaosium)",
  commit: sourceCommit,
  extractedAt: new Date().toISOString(),
}, null, 2) + "\n");

console.log(`技能 ${outSkills.length} 条（base 数值化 ${outSkills.filter(s => s.base !== null).length}，原文口径 ${outSkills.filter(s => s.base === null).length}）`);
console.log(`职业 ${outProfs.length} 条`);
console.log("样本技能:", JSON.stringify(outSkills.find(s => s.slug === "appraise") ?? outSkills[0], null, 1).slice(0, 400));
console.log("样本职业:", JSON.stringify(outProfs.find(p => p.slug === "detective") ?? outProfs[0], null, 1).slice(0, 400));
