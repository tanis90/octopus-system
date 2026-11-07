// Owner CI system artifact 组装/复核的负例回归（无 Foundry、无第三方依赖）。
//
//   node tools/tests/owner-ci-artifact-negative.mjs
//
// 在临时 git 仓里构造最小 runtime/content 两轴源树，先用 manifest.mjs 出证，
// 再验证 artifact.mjs 的 fail-closed 行为：
//   0. 正例：assemble → verify 通过；两次 assemble 的 zip 逐字节一致
//   1. zip 字节漂移（artifact sha256/size 不符）→ 非零
//   2. manifest 字节漂移（receipt.manifestSha256 不符）→ 非零
//   3. 内容工作树字节漂移 → 非零
//   4. 未证明来源的嵌套派生目录（modules/arcane-investigator-options/）→ 非零
//   5. system.json 声明的入口点不在 runtime 文件集 → 非零
//   6. 经符号链接调用 artifact.mjs 也必须真的执行（缺参数 → 非零），
//      不允许 realpath 不匹配导致静默 exit 0
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_TOOL = join(HERE, "../owner-ci/manifest.mjs");
const ARTIFACT_TOOL = join(HERE, "../owner-ci/artifact.mjs");
const checks = {};
const errors = [];
const check = (name, ok, detail) => {
  checks[name] = ok === true;
  if (ok !== true) errors.push(`${name}: ${JSON.stringify(detail ?? ok)}`);
};

const git = (cwd, args) => {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "owner-ci-test", GIT_AUTHOR_EMAIL: "owner-ci@test",
      GIT_COMMITTER_NAME: "owner-ci-test", GIT_COMMITTER_EMAIL: "owner-ci@test" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};

const runNode = (tool, args, cwd) => {
  const result = spawnSync(process.execPath, [tool, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const failIn = (outcome, mustContain, label) => {
  check(`${label}ExitNonZero`, outcome.status !== 0, { status: outcome.status, stderr: outcome.stderr.slice(0, 200) });
  if (mustContain) {
    check(`${label}NamesCause`, outcome.stderr.includes(mustContain),
      { expect: mustContain, stderr: outcome.stderr.slice(0, 400) });
  }
};

const write = (root, path, contents) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), contents);
};

const commitAll = (root, message) => {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
};

const collect = (kind, root, commit, outDir) => {
  const manifest = join(outDir, `${kind}-manifest.json`);
  const receipt = join(outDir, `${kind}-receipt.json`);
  const result = runNode(MANIFEST_TOOL, [
    "collect", "--kind", kind, "--commit", commit, "--root", root,
    "--out", manifest, "--receipt", receipt,
    "--command", `node tools/tests/fixture-${kind}.mjs`,
  ], root);
  if (result.status !== 0) throw new Error(`collect ${kind} 失败: ${result.stderr}`);
  return { manifest, receipt };
};

const assemble = (roots, owner, outDir) => runNode(ARTIFACT_TOOL, [
  "assemble",
  "--runtime-root", roots.runtime,
  "--content-root", roots.content,
  "--runtime-manifest", owner.runtime.manifest,
  "--runtime-receipt", owner.runtime.receipt,
  "--content-manifest", owner.content.manifest,
  "--content-receipt", owner.content.receipt,
  "--out-dir", outDir,
], roots.runtime);

const verify = (roots, owner, outDir) => runNode(ARTIFACT_TOOL, [
  "verify",
  "--artifact", join(outDir, "system.zip"),
  "--manifest", join(outDir, "system-manifest.json"),
  "--receipt", join(outDir, "system-receipt.json"),
  "--runtime-root", roots.runtime,
  "--content-root", roots.content,
  "--runtime-manifest", owner.runtime.manifest,
  "--runtime-receipt", owner.runtime.receipt,
  "--content-manifest", owner.content.manifest,
  "--content-receipt", owner.content.receipt,
], roots.runtime);

const runtimeSystemJson = {
  id: "brp",
  title: "fixture system",
  version: "0.0.1",
  compatibility: { minimum: "13", verified: "13.351", maximum: "13" },
  esmodules: ["module/brp.mjs", "module/setup/load.mjs"],
  styles: ["css/brp.css"],
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
  packs: [{ name: "fixture", label: "Fixture", path: "packs/fixture", type: "Item" }],
  license: "LICENSE.txt",
  changelog: "CHANGELOG.md",
};

const base = mkdtempSync(join(tmpdir(), "octopus-artifact-negative-"));
const runtimeRoot = join(base, "runtime");
const contentRoot = join(base, "content");
const ownerDir = join(base, "owner");
const outDir = join(base, "out");
const outDir2 = join(base, "out2");
try {
  for (const root of [runtimeRoot, contentRoot, ownerDir, outDir, outDir2]) mkdirSync(root, { recursive: true });

  // ---- fixture: runtime 轴
  git(runtimeRoot, ["init", "--initial-branch=main"]);
  write(runtimeRoot, "system.json", `${JSON.stringify(runtimeSystemJson, null, 2)}\n`);
  write(runtimeRoot, "module/brp.mjs", "export const brp = true;\n");
  write(runtimeRoot, "module/setup/load.mjs", "export const load = true;\n");
  write(runtimeRoot, "css/brp.css", ".brp {}\n");
  write(runtimeRoot, "lang/en.json", "{\"BRP\":{\"name\":\"Fixture\"}}\n");
  write(runtimeRoot, "LICENSE.txt", "MIT fixture license\n");
  write(runtimeRoot, "ORC-NOTICE.md", "# ORC fixture notice\n");
  write(runtimeRoot, "CHANGELOG.md", "# fixture changelog\n");
  write(runtimeRoot, "Readme.md", "# fixture readme\n");
  const runtimeCommit = commitAll(runtimeRoot, "fixture runtime axis");

  // ---- fixture: content 轴（独立 commit/仓，模拟 M8 钉住基线）
  git(contentRoot, ["init", "--initial-branch=main"]);
  write(contentRoot, "packs/fixture/a.json", "{\"_id\":\"a\"}\n");
  write(contentRoot, "packs-index/fixture.json", "{\"docs\":[1]}\n");
  write(contentRoot, "packs-json/fixture.json", "{\"docs\":[1]}\n");
  const contentCommit = commitAll(contentRoot, "fixture content axis");

  const owner = {
    runtime: collect("runtime", runtimeRoot, runtimeCommit, ownerDir),
    content: collect("content", contentRoot, contentCommit, ownerDir),
  };
  const roots = { runtime: runtimeRoot, content: contentRoot };

  // 0) 正例 + 两次构建确定性
  const first = assemble(roots, owner, outDir);
  check("assemblePositiveExitsZero", first.status === 0, first.stderr.slice(0, 500));
  check("assemblePositiveRecordsRunUrlNull", first.status === 0
    && JSON.parse(readFileSync(join(outDir, "system-receipt.json"), "utf8")).runUrl === null);
  const positiveVerify = verify(roots, owner, outDir);
  check("verifyPositiveExitsZero", positiveVerify.status === 0, positiveVerify.stderr.slice(0, 500));
  check("verifyPositiveReportsRebuild", positiveVerify.stdout.includes("\"rebuild\": \"byte-identical\""));
  const second = assemble(roots, owner, outDir2);
  check("assembleSecondBuildExitsZero", second.status === 0, second.stderr.slice(0, 500));
  check("twoBuildsByteIdentical", first.status === 0 && second.status === 0
    && readFileSync(join(outDir, "system.zip")).equals(readFileSync(join(outDir2, "system.zip")))
    && readFileSync(join(outDir, "system-manifest.json")).equals(readFileSync(join(outDir2, "system-manifest.json"))));

  // 1) zip 字节漂移（追加一个字节）→ 非零
  const tamperedZipDir = join(base, "tampered-zip");
  mkdirSync(tamperedZipDir, { recursive: true });
  copyFileSync(join(outDir, "system.zip"), join(tamperedZipDir, "system.zip"));
  writeFileSync(join(tamperedZipDir, "system.zip"), Buffer.concat([
    readFileSync(join(tamperedZipDir, "system.zip")), Buffer.from([0]),
  ]));
  const tamperedZip = runNode(ARTIFACT_TOOL, [
    "verify", "--artifact", join(tamperedZipDir, "system.zip"),
    "--manifest", join(outDir, "system-manifest.json"),
    "--receipt", join(outDir, "system-receipt.json"),
    "--runtime-root", runtimeRoot, "--content-root", contentRoot,
  ], runtimeRoot);
  failIn(tamperedZip, "manifest.artifact.sha256", "tamperedZip");

  // 2) manifest 字节漂移 → receipt.manifestSha256 不符
  const tamperedManifestDir = join(base, "tampered-manifest");
  mkdirSync(tamperedManifestDir, { recursive: true });
  copyFileSync(join(outDir, "system-manifest.json"), join(tamperedManifestDir, "system-manifest.json"));
  copyFileSync(join(outDir, "system-receipt.json"), join(tamperedManifestDir, "system-receipt.json"));
  const tamperedManifest = JSON.parse(readFileSync(join(tamperedManifestDir, "system-manifest.json"), "utf8"));
  tamperedManifest.artifact.sha256 = "0".repeat(64);
  writeFileSync(join(tamperedManifestDir, "system-manifest.json"),
    `${JSON.stringify(tamperedManifest, null, 2)}\n`);
  const tamperedManifestVerify = runNode(ARTIFACT_TOOL, [
    "verify", "--artifact", join(outDir, "system.zip"),
    "--manifest", join(tamperedManifestDir, "system-manifest.json"),
    "--receipt", join(tamperedManifestDir, "system-receipt.json"),
    "--runtime-root", runtimeRoot, "--content-root", contentRoot,
  ], runtimeRoot);
  failIn(tamperedManifestVerify, "receipt.manifestSha256", "tamperedManifest");

  // 3) content 工作树字节漂移 → 非零
  const contentFile = join(contentRoot, "packs-json/fixture.json");
  const contentBackup = readFileSync(contentFile);
  writeFileSync(contentFile, "{\"docs\":[999]}\n");
  failIn(verify(roots, owner, outDir), "工作树字节与 manifest 不符", "tamperedContent");
  writeFileSync(contentFile, contentBackup);

  // 4) 未证明来源的嵌套派生目录 → 非零（fresh commit + fresh owner manifest）
  write(runtimeRoot, "modules/arcane-investigator-options/unknown.json", "{}\n");
  const derivedCommit = commitAll(runtimeRoot, "fixture derived addition");
  const derivedOwner = {
    runtime: collect("runtime", runtimeRoot, derivedCommit, join(base, "owner-derived")),
    content: owner.content,
  };
  failIn(assemble(roots, derivedOwner, join(base, "out-derived")),
    "未证明来源的派生文件", "forbiddenDerivedPrefix");

  // 5) system.json 声明的入口点不在 runtime 集合 → 非零
  rmSync(join(runtimeRoot, "module/setup/load.mjs"));
  const missingEntryCommit = commitAll(runtimeRoot, "fixture missing entry point");
  const missingEntryOwner = {
    runtime: collect("runtime", runtimeRoot, missingEntryCommit, join(base, "owner-missing-entry")),
    content: owner.content,
  };
  failIn(assemble(roots, missingEntryOwner, join(base, "out-missing-entry")),
    "入口点不在 runtime 集合", "missingEntryPoint");

  // 6) 经符号链接调用也必须真的执行（缺参数 → 非零）
  const link = join(base, "artifact-via-link.mjs");
  symlinkSync(ARTIFACT_TOOL, link);
  const viaLink = spawnSync(process.execPath, [link], { encoding: "utf8" });
  check("symlinkedToolStillExecutesExitNonZero", viaLink.status !== 0,
    { status: viaLink.status, stderr: viaLink.stderr.slice(0, 200) });
  check("symlinkedToolNamesCause", viaLink.stderr.includes("缺少子命令"),
    { stderr: viaLink.stderr.slice(0, 400) });
} finally {
  rmSync(base, { recursive: true, force: true });
}

console.log(JSON.stringify({ checks: Object.keys(checks).length, failed: errors.length, errors, summary: checks }, null, 2));
if (errors.length) process.exit(1);
