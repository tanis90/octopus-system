// Owner CI 源码 provenance 工具：对明确的 file set 计算逐文件 path/size/sha256
// 与集合 hash，并产出 manifest + receipt（供源仓 owner CI 与本地验收共用）。
// 只依赖 node 与 git，无新第三方依赖；一切 hash 都来自源仓 git 树与工作树字节，
// 与任何前端仓 / 台账目录无关。
//
// 用法：
//   node tools/owner-ci/manifest.mjs collect --kind runtime|content \
//        --commit <rev> [--root <dir>] --out <manifest.json> --receipt <receipt.json> \
//        [--run-url <url>] [--expect-set-hash <hex>] [--command <cmd>]...
//
//   node tools/owner-ci/manifest.mjs verify --manifest <path> --receipt <path> [--root <dir>]
//
//   node tools/owner-ci/manifest.mjs set-hash --kind runtime|content \
//        [--commit <rev>] [--root <dir>]
//        （直接从 git 对象计算集合 hash，不要求 root 停在该 commit）
//
// file set 规则（可复现，不含任何魔法数字）：
//   runtime = git ls-tree -r --full-tree <commit> 的全部 tracked 文件，
//             剔除内容产物目录 packs/ packs-index/ packs-json/ 与 owner CI
//             自有文件（.github/、tools/owner-ci/、
//             tools/tests/owner-ci-verify-negative.mjs、docs/owner-ci.md）。
//             排除项是精确路径/目录：owner CI 自身合入与否不影响部署运行面的
//             集合口径，而 Readme/CHANGELOG 等真实仓文件的修改仍属漂移、不会被
//             这些排除项掩盖；
//   content = 同一 ls-tree 里位于 packs/ packs-index/ packs-json/ 之下的文件。
//
// 集合 hash：对按 path 升序（UTF-16 code unit 序）排列的条目，
//   sha256( "${path}\n${size}\n${sha256hex}\n" 逐条拼接 )。
// 命名空间：本工具的 setHash/artifactHash 属于 octopus-owner-ci-set-hash/1，
// 与前端 live-file-set-v1 的台账 hash 是不同命名空间，后续映射不得混用。
//
// collect 是 fail-closed 的：root 的 HEAD 必须等于 --commit，集合内每个文件的
// 工作树字节必须与其 git blob 逐字节一致（防御 smudge/换行转换，也覆盖一切
// tracked 漂移）。未跟踪的额外文件不属于 testedCommit 的集合，不阻塞 collect；
// 集合范围内的未跟踪/已修改漂移由 verify 负责报警。verify 复核 receipt↔manifest
// 绑定（manifestSha256/setHash/artifactHash 三向）、集合 hash、HEAD 绑定与
// 逐文件 hash；任何一项不符都以非零退出。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const TOOL = "tools/owner-ci/manifest.mjs";
const MANIFEST_SCHEMA = "octopus-owner-ci-manifest/1";
const RECEIPT_SCHEMA = "octopus-owner-ci-receipt/1";
const HASH_NAMESPACE = "octopus-owner-ci-set-hash/1";
const CONTENT_DIRS = ["packs/", "packs-index/", "packs-json/"];
const RUNTIME_OWNER_ONLY_EXCLUDES = [
  ".github/",
  "tools/owner-ci/",
  "tools/tests/owner-ci-verify-negative.mjs",
  "docs/owner-ci.md",
];

const isOwnerOnlyPath = (path) => RUNTIME_OWNER_ONLY_EXCLUDES
  .some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

const usage = (message) => {
  if (message) console.error(`${message}\n`);
  console.error(`用法:
  node ${TOOL} collect --kind runtime|content --commit <rev> [--root <dir>]
      --out <manifest.json> --receipt <receipt.json>
      [--run-url <url>] [--expect-set-hash <hex>] [--command <cmd>]...
  node ${TOOL} verify --manifest <path> --receipt <path> [--root <dir>]
  node ${TOOL} set-hash --kind runtime|content [--commit <rev>] [--root <dir>]`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = { command: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const key = eq > 0 && arg.startsWith("--") ? arg.slice(0, eq) : arg;
    const inline = eq > 0 && arg.startsWith("--") ? arg.slice(eq + 1) : undefined;
    const value = () => {
      if (inline !== undefined) return inline;
      i += 1;
      if (i >= argv.length) usage(`${key} 缺少参数`);
      return argv[i];
    };
    switch (key) {
      case "--kind": args.kind = value(); break;
      case "--commit": args.commit = value(); break;
      case "--root": args.root = value(); break;
      case "--out": args.out = value(); break;
      case "--receipt": args.receipt = value(); break;
      case "--run-url": args.runUrl = value(); break;
      case "--expect-set-hash": args.expectSetHash = value(); break;
      case "--command": args.command.push(value()); break;
      case "--manifest": args.manifest = value(); break;
      default: usage(`未知参数 ${arg}`);
    }
  }
  return args;
};

const runGit = (root, args, { input } = {}) => {
  const result = spawnSync("git", ["-C", root, ...args], {
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || Buffer.alloc(0)).toString("utf8").trim();
    throw new Error(`git ${args.join(" ")} 失败 (${result.status})${stderr ? `: ${stderr}` : ""}`);
  }
  return result.stdout;
};

const gitText = (root, args) => runGit(root, args).toString("utf8").trim();

// 没有 origin（本地临时副本、测试夹具）时 receipt.repo 记为 null，不算失败。
const originUrlOrNull = (root) => {
  const result = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
};

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

// `git ls-tree -r -z --full-tree <commit>` → [{ path, blobSha }]
const listTree = (root, commit) => {
  const raw = runGit(root, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  const out = [];
  for (const record of raw.toString("utf8").split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error(`ls-tree 记录无法解析: ${record}`);
    const meta = record.slice(0, tab);
    const path = record.slice(tab + 1);
    const blobSha = meta.split(" ")[2];
    if (!blobSha) throw new Error(`ls-tree 记录缺少 blob sha: ${record}`);
    out.push({ path, blobSha });
  }
  return out;
};

// `git cat-file --batch`（stdin 喂 blob sha）→ Map(blobSha → { size, bytes })
const readBlobs = (root, blobShas) => {
  const sizes = new Map();
  const bytes = new Map();
  if (!blobShas.length) return { sizes, bytes };
  const raw = runGit(root, ["cat-file", "--batch"], { input: `${blobShas.join("\n")}\n` });
  let cursor = 0;
  while (cursor < raw.length) {
    const headerEnd = raw.indexOf(0x0a, cursor);
    if (headerEnd < 0) throw new Error("cat-file --batch 输出缺头部");
    const header = raw.slice(cursor, headerEnd).toString("utf8").trim();
    const [sha, kind, sizeText] = header.split(/\s+/);
    if (kind === "missing") throw new Error(`git 对象缺失: ${sha}`);
    const size = Number(sizeText);
    if (!Number.isInteger(size) || size < 0) throw new Error(`cat-file 头部非法: ${header}`);
    const start = headerEnd + 1;
    bytes.set(sha, raw.slice(start, start + size));
    sizes.set(sha, size);
    cursor = start + size + 1; // 尾部换行
  }
  return { sizes, bytes };
};

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const canonicalSetHash = (entries) => sha256Hex(
  [...entries].sort(byPath).map((entry) => `${entry.path}\n${entry.size}\n${entry.sha256}\n`).join(""),
);

const fileSetRule = (kind) => ({
  runtime: {
    source: `git ls-tree -r --full-tree <testedCommit>`,
    exclude: [...CONTENT_DIRS, ...RUNTIME_OWNER_ONLY_EXCLUDES],
  },
  content: {
    source: `git ls-tree -r --full-tree <testedCommit>`,
    include: [...CONTENT_DIRS],
  },
}[kind]);

const inSet = (kind, path) => {
  if (kind === "content") return CONTENT_DIRS.some((prefix) => path.startsWith(prefix));
  if (CONTENT_DIRS.some((prefix) => path.startsWith(prefix))) return false;
  return !isOwnerOnlyPath(path);
};

// 从 git 对象推导并计算集合（不触碰工作树；set-hash 用，collect 也用它做逐字节交叉核对）。
const setFromGit = (root, kind, commit) => {
  const blobs = listTree(root, commit).filter((entry) => inSet(kind, entry.path));
  const { sizes, bytes } = readBlobs(root, blobs.map((entry) => entry.blobSha));
  const entries = blobs.map((entry) => ({
    path: entry.path,
    size: sizes.get(entry.blobSha),
    sha256: sha256Hex(bytes.get(entry.blobSha)),
  }));
  return { entries, setHash: canonicalSetHash(entries) };
};

const resolveCommit = (root, rev) => gitText(root, ["rev-parse", "--verify", `${rev}^{commit}`]);

const dirtyStatus = (root) => gitText(root, ["status", "--porcelain", "-uall"]);

const fail = (problems) => {
  console.error(`owner-ci manifest 校验失败 ${problems.length} 条：`);
  problems.slice(0, 12).forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
};

// ------------------------------------------------------------------ collect
const collect = (args) => {
  if (args.kind !== "runtime" && args.kind !== "content") usage("--kind 必须是 runtime|content");
  if (!args.commit) usage("collect 需要 --commit");
  if (!args.out || !args.receipt) usage("collect 需要 --out 与 --receipt");
  const root = resolve(args.root ?? process.cwd());
  const problems = [];

  const commit = resolveCommit(root, args.commit);
  const head = gitText(root, ["rev-parse", "HEAD"]);
  if (head !== commit) {
    problems.push(`HEAD ${head} != testedCommit ${commit}：collect 只对“正在被测的 checkout”出证`);
  }
  // tracked 文件的任何修改都会被下面的逐文件 blob 核对抓住；未跟踪文件不属于
  // testedCommit 的集合，不阻塞本地“先验收后提交”的出证流程。
  const fromGit = setFromGit(root, args.kind, commit);
  for (const entry of fromGit.entries) {
    let bytes;
    try {
      bytes = readFileSync(join(root, entry.path));
    } catch {
      problems.push(`集合内文件缺失: ${entry.path}`);
      continue;
    }
    if (bytes.length !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      problems.push(`工作树与 git blob 不一致: ${entry.path}`);
    }
  }
  if (args.expectSetHash && fromGit.setHash !== args.expectSetHash) {
    problems.push(`集合 hash 与期望不符: ${fromGit.setHash} != ${args.expectSetHash}`);
  }
  if (problems.length) fail(problems);

  const manifest = {
    schema: MANIFEST_SCHEMA,
    kind: args.kind,
    testedCommit: commit,
    fileSetRule: fileSetRule(args.kind),
    setHashAlgo: "sha256 over \"<path>\\n<size>\\n<sha256hex>\\n\" of entries sorted by path (code-unit order)",
    hashNamespace: HASH_NAMESPACE,
    setHash: fromGit.setHash,
    fileCount: fromGit.entries.length,
    files: [...fromGit.entries].sort(byPath),
  };
  const manifestPath = resolve(args.out);
  mkdirSync(dirname(manifestPath), { recursive: true });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(manifestPath, manifestBytes);

  const receipt = {
    schema: RECEIPT_SCHEMA,
    kind: args.kind,
    repo: originUrlOrNull(root),
    testedCommit: commit,
    result: "passed",
    commands: [...args.command],
    runUrl: args.runUrl ?? null,
    manifest: args.out,
    manifestSha256: sha256Hex(manifestBytes),
    // setHash 与 artifactHash 是同一集合 hash 的双字段：artifactHash 供前端
    // strict ci.binds.artifactHash 直接消费；两者都必须与 manifest 一致。
    setHash: manifest.setHash,
    artifactHash: manifest.setHash,
    fileCount: manifest.fileCount,
    generatedBy: TOOL,
  };
  const receiptPath = resolve(args.receipt);
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    kind: manifest.kind,
    testedCommit: commit,
    fileCount: manifest.fileCount,
    setHash: manifest.setHash,
    manifest: manifestPath,
    receipt: receiptPath,
    runUrl: receipt.runUrl,
  }, null, 2));
};

// ------------------------------------------------------------------- verify
const verify = (args) => {
  if (!args.manifest || !args.receipt) usage("verify 需要 --manifest 与 --receipt");
  const root = resolve(args.root ?? process.cwd());
  const problems = [];

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
  } catch (error) {
    fail([`manifest 无法读取: ${error.message}`]);
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(args.receipt, "utf8"));
  } catch (error) {
    fail([`receipt 无法读取: ${error.message}`]);
  }

  const manifestBytes = readFileSync(args.manifest);
  if (receipt.manifestSha256 !== sha256Hex(manifestBytes)) {
    problems.push(`receipt.manifestSha256 与 manifest 实际字节不符: ${receipt.manifestSha256}`);
  }
  if (manifest.schema !== MANIFEST_SCHEMA) problems.push(`manifest.schema ${manifest.schema} != ${MANIFEST_SCHEMA}`);
  if (receipt.schema !== RECEIPT_SCHEMA) problems.push(`receipt.schema ${receipt.schema} != ${RECEIPT_SCHEMA}`);
  if (manifest.kind !== receipt.kind) problems.push(`kind 不一致: manifest=${manifest.kind} receipt=${receipt.kind}`);
  if (receipt.result !== "passed") problems.push(`receipt.result=${receipt.result}，非绿结果不得通过 verify`);
  if (manifest.setHash !== canonicalSetHash(manifest.files ?? [])) {
    problems.push("manifest.setHash 与 manifest.files 重新计算结果不符");
  }
  if (receipt.setHash !== manifest.setHash) problems.push("receipt.setHash != manifest.setHash");
  if (receipt.artifactHash !== manifest.setHash) {
    problems.push(`receipt.artifactHash != manifest.setHash: ${receipt.artifactHash}`);
  }
  if (manifest.hashNamespace !== HASH_NAMESPACE) {
    problems.push(`manifest.hashNamespace ${manifest.hashNamespace} != ${HASH_NAMESPACE}`);
  }
  if (receipt.fileCount !== manifest.fileCount || manifest.fileCount !== (manifest.files ?? []).length) {
    problems.push("fileCount 三方不一致");
  }
  if (!Array.isArray(receipt.commands) || receipt.commands.length === 0) {
    problems.push("receipt.commands 为空：result=passed 必须记录实际执行的测试命令");
  }

  const commit = resolveCommit(root, manifest.testedCommit);
  const head = gitText(root, ["rev-parse", "HEAD"]);
  if (head !== commit) problems.push(`HEAD ${head} != manifest.testedCommit ${commit}`);

  const fromGit = setFromGit(root, manifest.kind, commit);
  const expected = new Map(fromGit.entries.map((entry) => [entry.path, entry]));
  const recorded = new Map((manifest.files ?? []).map((entry) => [entry.path, entry]));
  for (const [path, entry] of expected) {
    if (!recorded.has(path)) problems.push(`manifest 缺少集合内文件: ${path}`);
  }
  for (const path of recorded.keys()) {
    if (!expected.has(path)) problems.push(`manifest 多出集合外文件: ${path}`);
  }
  for (const [path, entry] of expected) {
    const listed = recorded.get(path);
    if (listed && (listed.sha256 !== entry.sha256 || listed.size !== entry.size)) {
      problems.push(`manifest 记录与 git 对象不符: ${path}`);
    }
    let bytes;
    try {
      bytes = readFileSync(join(root, path));
    } catch {
      problems.push(`文件缺失: ${path}`);
      continue;
    }
    if (bytes.length !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      problems.push(`工作树字节与 testedCommit 不符: ${path}`);
    }
  }
  // 集合范围内不得有未跟踪/已修改的漂移；CI 产物目录等集合外路径不算。
  const dirty = dirtyStatus(root);
  if (dirty) {
    const inScope = dirty.split("\n").filter((line) => {
      const path = line.slice(3).trim().replace(/^"|"$/g, "");
      return inSet(manifest.kind, path);
    });
    if (inScope.length) problems.push(`集合范围内工作树漂移: ${inScope.slice(0, 8).join(" | ")}`);
  }

  if (problems.length) fail(problems);
  console.log(JSON.stringify({
    kind: manifest.kind,
    testedCommit: manifest.testedCommit,
    fileCount: manifest.fileCount,
    setHash: manifest.setHash,
    result: "verified",
    root,
  }, null, 2));
};

// ----------------------------------------------------------------- set-hash
const setHash = (args) => {
  if (args.kind !== "runtime" && args.kind !== "content") usage("--kind 必须是 runtime|content");
  const root = resolve(args.root ?? process.cwd());
  const commit = args.commit ? resolveCommit(root, args.commit) : gitText(root, ["rev-parse", "HEAD"]);
  const { setHash: hash, entries } = setFromGit(root, args.kind, commit);
  console.log(JSON.stringify({ kind: args.kind, commit, fileCount: entries.length, setHash: hash }, null, 2));
};

const main = () => {
  const [mode, ...rest] = process.argv.slice(2);
  try {
    if (mode === "collect") collect(parseArgs(rest));
    else if (mode === "verify") verify(parseArgs(rest));
    else if (mode === "set-hash") setHash(parseArgs(rest));
    else usage(mode ? `未知子命令 ${mode}` : "缺少子命令");
  } catch (error) {
    fail([error.message]);
  }
};
// 直调判定两边都按 realpath 比较：node 默认对模块路径取 realpath，argv[1] 若
// 经符号链接调用不作 realpath 会让 main() 静默不执行（fail-open），这里必须一致。
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) main();

export { canonicalSetHash, fileSetRule, inSet, setFromGit };
