// Owner CI manifest/verify 工具的负例回归（无 Foundry、无第三方依赖）。
//
//   node tools/tests/owner-ci-verify-negative.mjs
//
// 在临时 git 仓里构造一个最小源树，逐一验证 verify 的 fail-closed 行为：
//   0. 正例：collect → verify 通过（对照，必须为 0）
//   1. 字节绑定：改一个 tracked 文件的内容（不提交）→ 非零
//   2. 缺件：删除一个集合内文件 → 非零
//   3. 集合漂移：集合目录下多一个未跟踪文件 → 非零
//   4. commit 绑定：HEAD 前进到新提交，manifest 仍指向旧 commit → 非零
//   5. receipt 绑定：回到被测 commit 后改 manifest 字节 → manifestSha256 不符 → 非零
//   6. 非绿 receipt：result != passed → 非零
//   7. artifactHash 绑定：receipt 只改 artifactHash → 与 manifest.setHash 不符 → 非零
//   8. 直调守卫：经符号链接路径调用工具 → 必须真的执行（缺 manifest 报错非零），
//      不允许因 realpath 不匹配而静默 exit 0
// 每个负例同时断言退出码非零与具体错误信息；任何正例失败或负例意外通过
// 都以非零退出。
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, "../owner-ci/manifest.mjs");
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

const run = (args, cwd) => {
  const result = spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const failIn = (outcome, mustContain, label) => {
  check(`${label}ExitNonZero`, outcome.status !== 0, { status: outcome.status, stderr: outcome.stderr.slice(0, 200) });
  if (mustContain) {
    check(`${label}NamesCause`, outcome.stderr.includes(mustContain),
      { expect: mustContain, stderr: outcome.stderr.slice(0, 400) });
  }
};

const temp = mkdtempSync(join(tmpdir(), "octopus-owner-ci-negative-"));
const outDir = mkdtempSync(join(tmpdir(), "octopus-owner-ci-out-"));
try {
  git(temp, ["init", "--initial-branch=main"]);
  mkdirSync(join(temp, "packs-json"), { recursive: true });
  writeFileSync(join(temp, "a.txt"), "runtime file alpha\n");
  writeFileSync(join(temp, "packs-json/pack-one.json"), "{\"docs\": [1]}\n");
  writeFileSync(join(temp, "packs-json/pack-two.json"), "{\"docs\": [2]}\n");
  git(temp, ["add", "."]);
  git(temp, ["commit", "-m", "fixture c1"]);
  const c1 = git(temp, ["rev-parse", "HEAD"]);

  const manifest = join(outDir, "manifest.json");
  const receipt = join(outDir, "receipt.json");
  const collect = () => run(["collect", "--kind", "content", "--commit", c1,
    "--root", temp, "--out", manifest, "--receipt", receipt,
    "--command", "node tools/tests/fake-suite.mjs"], temp);
  const verify = () => run(["verify", "--manifest", manifest, "--receipt", receipt, "--root", temp], temp);

  // 0) 正例：内容集合出证并复核通过
  check("collectCleanTreeExitsZero", collect().status === 0);
  check("verifyPositiveExitsZero", verify().status === 0);
  const collected = JSON.parse(readFileSync(manifest, "utf8"));
  check("fileSetIsContentOnly", collected.fileCount === 2
    && collected.files.every((entry) => entry.path.startsWith("packs-json/")), collected.fileCount);
  check("receiptRecordsRunUrlNullByDefault", JSON.parse(readFileSync(receipt, "utf8")).runUrl === null);

  // 1) 字节绑定：改内容不提交 → verify 必须失败
  writeFileSync(join(temp, "packs-json/pack-one.json"), "{\"docs\": [999]}\n");
  failIn(verify(), "工作树字节与 testedCommit 不符", "tamperedContent");
  writeFileSync(join(temp, "packs-json/pack-one.json"), "{\"docs\": [1]}\n");

  // 2) 缺件：删掉集合内文件 → verify 必须失败
  const backup = readFileSync(join(temp, "packs-json/pack-two.json"));
  spawnSync("rm", ["-f", join(temp, "packs-json/pack-two.json")]);
  check("removeSetup", !existsSync(join(temp, "packs-json/pack-two.json")));
  failIn(verify(), "文件缺失", "missingFile");
  writeFileSync(join(temp, "packs-json/pack-two.json"), backup);

  // 3) 集合漂移：集合目录下多一个未跟踪文件 → verify 必须失败
  writeFileSync(join(temp, "packs-json/pack-extra.json"), "{}\n");
  failIn(verify(), "集合范围内工作树漂移", "untrackedExtraInSet");

  // 4) commit 绑定：把多余文件提交掉，HEAD 前进而 manifest 仍指 c1 → 必须失败
  git(temp, ["add", "packs-json/pack-extra.json"]);
  git(temp, ["commit", "-m", "fixture c2"]);
  failIn(verify(), "HEAD", "movedHead");

  // 5) receipt 绑定：回到被测 commit（工作树字节回到出证时），改 manifest 字节 → 必须失败
  git(temp, ["checkout", "--detach", c1]);
  check("backToTestedCommitClean", git(temp, ["status", "--porcelain"]) === "");
  const tampered = JSON.parse(readFileSync(manifest, "utf8"));
  tampered.files[0].sha256 = "0".repeat(64);
  writeFileSync(manifest, `${JSON.stringify(tampered, null, 2)}\n`);
  failIn(verify(), "manifestSha256", "tamperedManifestBytes");

  // 6) 非绿 receipt：result != passed → 必须失败
  check("recollectStillGreen", collect().status === 0);
  const receiptJson = JSON.parse(readFileSync(receipt, "utf8"));
  receiptJson.result = "failed";
  writeFileSync(receipt, `${JSON.stringify(receiptJson, null, 2)}\n`);
  failIn(verify(), "receipt.result", "notPassedReceipt");

  // 7) artifactHash 绑定：receipt 其它字段不动、只改 artifactHash → 必须失败
  check("recollectStillGreenAgain", collect().status === 0);
  const receiptJson2 = JSON.parse(readFileSync(receipt, "utf8"));
  receiptJson2.artifactHash = "f".repeat(64);
  writeFileSync(receipt, `${JSON.stringify(receiptJson2, null, 2)}\n`);
  failIn(verify(), "receipt.artifactHash", "tamperedArtifactHash");

  // 8) 直调守卫：经符号链接调用也必须真的执行（缺文件 → 非零），
  //    禁止 realpath 不匹配导致的静默 exit 0
  const link = join(outDir, "manifest-via-link.mjs");
  symlinkSync(TOOL, link);
  const viaLink = spawnSync(process.execPath, [link, "verify",
    "--manifest", join(outDir, "no-such-manifest.json"),
    "--receipt", join(outDir, "no-such-receipt.json")], { encoding: "utf8" });
  check("symlinkedToolStillExecutesExitNonZero", viaLink.status !== 0,
    { status: viaLink.status, stderr: viaLink.stderr.slice(0, 200) });
  check("symlinkedToolNamesCause", viaLink.stderr.includes("manifest 无法读取"),
    { stderr: viaLink.stderr.slice(0, 400) });
} finally {
  rmSync(temp, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
}

console.log(JSON.stringify({ checks: Object.keys(checks).length, failed: errors.length, errors, summary: checks }, null, 2));
if (errors.length) process.exit(1);
