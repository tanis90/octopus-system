// Owner CI system artifact assembler：把已通过 owner CI 两条语义线的
// runtime / content 两个 file set 组装成前端可直接消费的 BRP 系统产物。
//
// 用法：
//   node tools/owner-ci/artifact.mjs assemble \
//        --runtime-root <dir> --content-root <dir> \
//        --runtime-manifest <runtime-manifest.json> --runtime-receipt <runtime-receipt.json> \
//        --content-manifest <content-manifest.json> --content-receipt <content-receipt.json> \
//        --out-dir <dir> [--run-url <url>] [--system-id brp]
//
//   node tools/owner-ci/artifact.mjs verify \
//        --artifact <system.zip> --manifest <system-manifest.json> --receipt <system-receipt.json> \
//        [--runtime-root <dir> --content-root <dir>] \
//        [--runtime-manifest <path> --runtime-receipt <path> \
//         --content-manifest <path> --content-receipt <path>]
//
// 设计约束（与 owner CI 的 manifest.mjs 同一口径）：
//   - 两个轴绝不合并：runtime 的文件集来自 runtime 源 commit，content 的文件集
//     来自 content-pin.json 钉住的已发布基线；assemble 只接受两份 owner CI
//     manifest + receipt，逐文件、逐集合 hash 复核后才打包。
//   - 产物是 system root 布局的确定性 zip（store，无压缩；路径按 UTF-16
//     code unit 升序；固定 1980-01-01 时间戳；0644 普通文件；UTF-8 文件名）。
//     同一输入重复构建必须逐字节一致。
//   - 不收未知的嵌套派生目录（默认拒绝 modules/arcane-investigator-options/：
//     上一版前端产物里的 187 个文件没有源仓 commit 证明）。
//   - manifest 只描述源仓 commit / 集合 hash / 文件字节与 zip hash；不含前端
//     台账 hash，也不引入 runtimeHost 或任何 Auto/内容迁移逻辑。
//   - receipt 的 runUrl 本地为 null；只有真实 CI run 才允许写入实际 URL。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { canonicalSetHash, inSet, setFromGit } from "./manifest.mjs";

const TOOL = "tools/owner-ci/artifact.mjs";
const MANIFEST_SCHEMA = "octopus-system-artifact/1";
const RECEIPT_SCHEMA = "octopus-system-artifact-receipt/1";
const OWNER_MANIFEST_SCHEMA = "octopus-owner-ci-manifest/1";
const OWNER_RECEIPT_SCHEMA = "octopus-owner-ci-receipt/1";
const HASH_NAMESPACE = "octopus-owner-ci-set-hash/1";
const ZIP_RECIPE = "octopus-system-artifact-zip/1: store, paths sorted (code-unit order), "
  + "fixed 1980-01-01T00:00:00Z DOS timestamp, 0644 regular files, UTF-8 names";
const ZIP_FILE = "system.zip";
const ARTIFACT_MANIFEST_FILE = "system-manifest.json";
const ARTIFACT_RECEIPT_FILE = "system-receipt.json";
const REQUIRED_NOTICES = ["LICENSE.txt", "ORC-NOTICE.md"];
const DEFAULT_FORBIDDEN_PREFIXES = ["modules/arcane-investigator-options/"];
const AXES = ["runtime", "content"];

const usage = (message) => {
  if (message) console.error(`${message}\n`);
  console.error(`用法:
  node ${TOOL} assemble --runtime-root <dir> --content-root <dir>
      --runtime-manifest <json> --runtime-receipt <json>
      --content-manifest <json> --content-receipt <json>
      --out-dir <dir> [--run-url <url>] [--system-id brp]
  node ${TOOL} verify --artifact <zip> --manifest <json> --receipt <json>
      [--runtime-root <dir> --content-root <dir>]
      [--runtime-manifest <json> --runtime-receipt <json>
       --content-manifest <json> --content-receipt <json>]`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = { forbiddenPrefix: [...DEFAULT_FORBIDDEN_PREFIXES], systemId: "brp" };
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
      case "--runtime-root": args.runtimeRoot = value(); break;
      case "--content-root": args.contentRoot = value(); break;
      case "--runtime-manifest": args.runtimeManifest = value(); break;
      case "--runtime-receipt": args.runtimeReceipt = value(); break;
      case "--content-manifest": args.contentManifest = value(); break;
      case "--content-receipt": args.contentReceipt = value(); break;
      case "--out-dir": args.outDir = value(); break;
      case "--run-url": args.runUrl = value(); break;
      case "--system-id": args.systemId = value(); break;
      case "--forbid-prefix": args.forbiddenPrefix.push(value()); break;
      case "--artifact": args.artifact = value(); break;
      case "--manifest": args.manifest = value(); break;
      case "--receipt": args.receipt = value(); break;
      default: usage(`未知参数 ${arg}`);
    }
  }
  return args;
};

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

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
const resolveCommit = (root, rev) => gitText(root, ["rev-parse", "--verify", `${rev}^{commit}`]);
const dirtyStatus = (root) => gitText(root, ["status", "--porcelain", "-uall"]);

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const isFullCommit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

const fail = (problems) => {
  console.error(`owner-ci system artifact 校验失败 ${problems.length} 条：`);
  problems.slice(0, 16).forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
};

const readJsonFile = (path, label, problems) => {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    problems.push(`${label} 无法读取: ${error.message}`);
    return { bytes: null, json: null };
  }
  try {
    return { bytes, json: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    problems.push(`${label} 不是合法 JSON: ${error.message}`);
    return { bytes, json: null };
  }
};

// 复核一份 owner CI manifest + receipt，并把它与 root 的 git 对象、工作树字节
// 三方对齐。返回的 entries 是 manifest 记录的精确文件集（不是重新编的列表）。
const loadOwnerAxis = (axis, paths, root) => {
  const problems = [];
  if (!paths.manifest || !paths.receipt) problems.push(`${axis}: 缺少 manifest/receipt 路径`);
  if (!root) problems.push(`${axis}: 缺少 --${axis}-root`);
  if (problems.length) fail(problems);

  const manifestFile = readJsonFile(paths.manifest, `${axis} manifest`, problems);
  const receiptFile = readJsonFile(paths.receipt, `${axis} receipt`, problems);
  if (problems.length) fail(problems);
  const manifest = manifestFile.json;
  const receipt = receiptFile.json;

  if (manifest.schema !== OWNER_MANIFEST_SCHEMA) {
    problems.push(`${axis}: manifest.schema ${manifest.schema} != ${OWNER_MANIFEST_SCHEMA}`);
  }
  if (receipt.schema !== OWNER_RECEIPT_SCHEMA) {
    problems.push(`${axis}: receipt.schema ${receipt.schema} != ${OWNER_RECEIPT_SCHEMA}`);
  }
  if (manifest.kind !== axis) problems.push(`${axis}: manifest.kind ${manifest.kind} != ${axis}`);
  if (receipt.kind !== axis) problems.push(`${axis}: receipt.kind ${receipt.kind} != ${axis}`);
  if (receipt.result !== "passed") {
    problems.push(`${axis}: receipt.result=${receipt.result}，非绿结果不得进入系统产物`);
  }
  if (!Array.isArray(receipt.commands) || receipt.commands.length === 0) {
    problems.push(`${axis}: receipt.commands 为空，无法证明语义门确实执行过`);
  }
  if (receipt.manifestSha256 !== sha256Hex(manifestFile.bytes)) {
    problems.push(`${axis}: receipt.manifestSha256 与 manifest 实际字节不符`);
  }
  if (manifest.hashNamespace !== HASH_NAMESPACE) {
    problems.push(`${axis}: manifest.hashNamespace ${manifest.hashNamespace} != ${HASH_NAMESPACE}`);
  }

  const files = Array.isArray(manifest.files) ? manifest.files : null;
  if (!files) {
    problems.push(`${axis}: manifest.files 不是数组`);
    return fail(problems);
  }
  for (let i = 0; i < files.length; i += 1) {
    const entry = files[i];
    if (!entry || typeof entry.path !== "string" || !entry.path) {
      problems.push(`${axis}: files[${i}] 缺少 path`);
      continue;
    }
    if (!Number.isInteger(entry.size) || entry.size < 0) {
      problems.push(`${axis}: ${entry.path} size 非整数`);
    }
    if (!isSha256(entry.sha256)) problems.push(`${axis}: ${entry.path} sha256 非法`);
    if (i > 0 && byPath(files[i - 1], entry) >= 0) {
      problems.push(`${axis}: files 未按 path 严格升序或存在重复: ${entry.path}`);
    }
  }
  if (manifest.setHash !== canonicalSetHash(files)) {
    problems.push(`${axis}: manifest.setHash 与 manifest.files 重新计算结果不符`);
  }
  if (receipt.setHash !== manifest.setHash) problems.push(`${axis}: receipt.setHash != manifest.setHash`);
  if (receipt.artifactHash !== manifest.setHash) {
    problems.push(`${axis}: receipt.artifactHash != manifest.setHash`);
  }
  if (manifest.fileCount !== files.length || receipt.fileCount !== files.length) {
    problems.push(`${axis}: fileCount 三方不一致`);
  }
  if (manifest.testedCommit !== receipt.testedCommit) {
    problems.push(`${axis}: manifest/receipt testedCommit 不一致`);
  }
  if (!isFullCommit(manifest.testedCommit)) {
    problems.push(`${axis}: testedCommit 不是完整 40 位 commit`);
    return fail(problems);
  }

  const commit = resolveCommit(root, manifest.testedCommit);
  const head = gitText(root, ["rev-parse", "HEAD"]);
  if (head !== commit) {
    problems.push(`${axis}: root HEAD ${head} != testedCommit ${commit}`);
  }

  const fromGit = setFromGit(root, axis, commit);
  const expected = new Map(fromGit.entries.map((entry) => [entry.path, entry]));
  const recorded = new Map(files.map((entry) => [entry.path, entry]));
  for (const [path, entry] of expected) {
    if (!recorded.has(path)) problems.push(`${axis}: manifest 缺少集合内文件: ${path}`);
    const listed = recorded.get(path);
    if (listed && (listed.size !== entry.size || listed.sha256 !== entry.sha256)) {
      problems.push(`${axis}: manifest 记录与 git 对象不符: ${path}`);
    }
  }
  for (const path of recorded.keys()) {
    if (!expected.has(path)) problems.push(`${axis}: manifest 多出集合外文件: ${path}`);
  }
  if (fromGit.setHash !== manifest.setHash) {
    problems.push(`${axis}: git 集合 hash ${fromGit.setHash} != manifest.setHash ${manifest.setHash}`);
  }

  let bytesTotal = 0;
  for (const entry of files) {
    let bytes;
    try {
      bytes = readFileSync(join(root, entry.path));
    } catch {
      problems.push(`${axis}: 集合内文件缺失: ${entry.path}`);
      continue;
    }
    if (bytes.length !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      problems.push(`${axis}: 工作树字节与 manifest 不符: ${entry.path}`);
    }
    bytesTotal += entry.size;
  }

  const dirty = dirtyStatus(root);
  if (dirty) {
    const inScope = dirty.split("\n").filter((line) => {
      const path = line.slice(3).trim().replace(/^"|"$/g, "");
      return inSet(axis, path);
    });
    if (inScope.length) {
      problems.push(`${axis}: 集合范围内工作树漂移: ${inScope.slice(0, 8).join(" | ")}`);
    }
  }

  if (problems.length) fail(problems);
  return {
    axis,
    root: resolve(root),
    manifest,
    receipt,
    manifestBytes: manifestFile.bytes,
    receiptBytes: receiptFile.bytes,
    manifestSha256: sha256Hex(manifestFile.bytes),
    receiptSha256: sha256Hex(receiptFile.bytes),
    commit,
    setHash: manifest.setHash,
    files,
    bytesTotal,
  };
};

const unionEntries = (axes) => {
  const problems = [];
  const seen = new Map();
  const entries = [];
  for (const axis of AXES) {
    for (const entry of axes[axis].files) {
      if (seen.has(entry.path)) {
        problems.push(`路径在 runtime/content 两轴重复: ${entry.path}`);
        continue;
      }
      seen.set(entry.path, axis);
      entries.push({ ...entry, axis });
    }
  }
  return { entries: entries.sort(byPath), problems, axisByPath: seen };
};

const checkForbidden = (entries, prefixes) => {
  const problems = [];
  for (const entry of entries) {
    for (const prefix of prefixes) {
      if (entry.path === prefix.replace(/\/$/, "") || entry.path.startsWith(prefix)) {
        problems.push(`包含未证明来源的派生文件（${prefix}）: ${entry.path}`);
      }
    }
  }
  return problems;
};

// system.json 是系统产物的唯一身份锚：id/version/host generation/入口点全部
// 从产物内的 system.json 读取，再与文件清单对照，不维护第二份魔法常量。
const inspectSystem = ({ systemBytes, runtimeFiles, allFiles, expectedSystemId }) => {
  const problems = [];
  const runtimeMap = new Map(runtimeFiles.map((entry) => [entry.path, entry]));
  const allMap = new Map(allFiles.map((entry) => [entry.path, entry]));
  const systemEntry = runtimeMap.get("system.json");
  if (!systemEntry) problems.push("runtime 集合缺少 system.json");
  if (systemEntry && (systemEntry.size !== systemBytes.length || systemEntry.sha256 !== sha256Hex(systemBytes))) {
    problems.push("system.json 字节与 runtime manifest 记录不符");
  }

  let system;
  try {
    system = JSON.parse(systemBytes.toString("utf8"));
  } catch (error) {
    problems.push(`system.json 不是合法 JSON: ${error.message}`);
    return { problems, system: null, notices: [] };
  }
  if (system.id !== expectedSystemId) {
    problems.push(`system.json id ${system.id} != 期望 ${expectedSystemId}`);
  }
  if (typeof system.version !== "string" || !system.version) {
    problems.push("system.json 缺少 version");
  }
  const compatibility = system.compatibility ?? {};
  const minimum = String(compatibility.minimum ?? "");
  const verified = String(compatibility.verified ?? "");
  const maximum = String(compatibility.maximum ?? "");
  const hostGeneration = minimum || verified.split(".")[0];
  if (!hostGeneration) problems.push("system.json 缺少 compatibility.minimum/verified，无法确定 host generation");
  if (verified && verified.split(".")[0] !== hostGeneration) {
    problems.push(`system.json compatibility.verified ${verified} 与 host generation ${hostGeneration} 不一致`);
  }
  if (maximum && maximum !== hostGeneration) {
    problems.push(`system.json compatibility.maximum ${maximum} != host generation ${hostGeneration}`);
  }

  const entryPoints = system.esmodules;
  if (!Array.isArray(entryPoints) || entryPoints.length === 0) {
    problems.push("system.json esmodules 为空，无法确定入口点");
  } else {
    for (const path of entryPoints) {
      if (typeof path !== "string" || !path) problems.push(`system.json esmodules 含非法路径: ${path}`);
      else if (!runtimeMap.has(path)) problems.push(`入口点不在 runtime 集合: ${path}`);
    }
  }
  for (const path of system.styles ?? []) {
    if (!runtimeMap.has(path)) problems.push(`style 不在 runtime 集合: ${path}`);
  }
  for (const language of system.languages ?? []) {
    if (language?.path && !runtimeMap.has(language.path)) {
      problems.push(`language 文件不在 runtime 集合: ${language.path}`);
    }
  }
  for (const pack of system.packs ?? []) {
    if (!pack?.path) continue;
    const prefix = `${pack.path}/`;
    if (!allFiles.some((entry) => entry.path.startsWith(prefix))) {
      problems.push(`system.json 声明的 pack 目录没有内容文件: ${pack.path}`);
    }
  }

  const licensePaths = [];
  if (typeof system.license === "string" && system.license) licensePaths.push(system.license);
  const noticePaths = [...new Set([...REQUIRED_NOTICES, ...licensePaths])];
  const notices = [];
  for (const path of noticePaths) {
    const entry = allMap.get(path);
    if (!entry) {
      problems.push(`缺少必需的许可/声明文件: ${path}`);
      continue;
    }
    if (entry.size === 0) problems.push(`许可/声明文件为空: ${path}`);
    notices.push({
      path,
      kind: licensePaths.includes(path) ? "license" : "notice",
      size: entry.size,
      sha256: entry.sha256,
    });
  }
  if (typeof system.changelog === "string" && system.changelog && !allMap.has(system.changelog)) {
    problems.push(`system.json changelog 不在产物内: ${system.changelog}`);
  }

  return {
    problems,
    system: {
      id: system.id,
      version: system.version,
      title: system.title ?? "",
      hostGeneration,
      hostVersionVerified: verified,
      hostCompatibility: { minimum, verified, maximum },
      entryPoints: entryPoints ?? [],
      license: typeof system.license === "string" ? system.license : null,
      changelog: typeof system.changelog === "string" ? system.changelog : null,
    },
    notices,
  };
};

// ---------------------------------------------------------------- zip writer
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01
const UTF8_FLAG = 0x0800;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 0x0314; // Unix, zip 2.0
const EXTERNAL_ATTR = (0o100644 << 16) >>> 0;

// 无第三方依赖的确定性 zip writer。只支持 store：规则最小、跨 Node/zlib
// 版本字节稳定，符合“同一输入两次构建逐字节一致”的验收口径。
const makeZip = (files) => {
  const ordered = [...files].sort(byPath);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of ordered) {
    const name = Buffer.from(file.path, "utf8");
    const data = file.bytes;
    const crc = crc32(data);

    const local = Buffer.alloc(LOCAL_HEADER_SIZE);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const cd = Buffer.alloc(CENTRAL_HEADER_SIZE);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(VERSION_MADE_BY, 4);
    cd.writeUInt16LE(VERSION_NEEDED, 6);
    cd.writeUInt16LE(UTF8_FLAG, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(EXTERNAL_ATTR, 38);
    cd.writeUInt32LE(offset, 42);

    chunks.push(local, name, data);
    central.push(cd, name);
    offset += local.length + name.length + data.length;
  }

  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(EOCD_SIZE);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(ordered.length, 8);
  eocd.writeUInt16LE(ordered.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBytes, eocd]);
};

// 只解析本工具 recipe 产生的 zip；任何方法/标志/时间戳/次序不符都按漂移报错。
const readZip = (bytes) => {
  const problems = [];
  if (bytes.length < EOCD_SIZE) {
    return { problems: ["zip 小于 EOCD 长度"], entries: [] };
  }
  const eocdOffset = bytes.length - EOCD_SIZE;
  if (bytes.readUInt32LE(eocdOffset) !== 0x06054b50) {
    return { problems: ["zip 末尾不是 EOCD（不允许 comment）"], entries: [] };
  }
  if (bytes.readUInt16LE(eocdOffset + 4) !== 0 || bytes.readUInt16LE(eocdOffset + 6) !== 0) {
    problems.push("zip 使用了多磁盘字段");
  }
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize !== eocdOffset) {
    problems.push("zip central directory 边界与 EOCD 不符");
  }

  let cursor = centralOffset;
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      problems.push(`zip central 第 ${index} 条签名非法`);
      break;
    }
    const method = bytes.readUInt16LE(cursor + 10);
    const flags = bytes.readUInt16LE(cursor + 8);
    const time = bytes.readUInt16LE(cursor + 12);
    const date = bytes.readUInt16LE(cursor + 14);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const nameStart = cursor + CENTRAL_HEADER_SIZE;
    const name = bytes.toString("utf8", nameStart, nameStart + nameLength);
    if (method !== 0) problems.push(`zip 条目不是 store: ${name}`);
    if (flags !== UTF8_FLAG) problems.push(`zip 条目 flags 非预期: ${name}`);
    if (time !== DOS_TIME || date !== DOS_DATE) problems.push(`zip 条目时间戳非固定值: ${name}`);
    if (compressedSize !== uncompressedSize) problems.push(`zip 条目压缩大小不一致: ${name}`);
    if (localOffset + LOCAL_HEADER_SIZE > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      problems.push(`zip local 头非法: ${name}`);
      cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
      continue;
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localName = bytes.toString("utf8", localOffset + LOCAL_HEADER_SIZE,
      localOffset + LOCAL_HEADER_SIZE + localNameLength);
    if (localName !== name) problems.push(`zip local/central 文件名不一致: ${name}`);
    if (bytes.readUInt16LE(localOffset + 6) !== UTF8_FLAG) problems.push(`zip local flags 非预期: ${name}`);
    if (bytes.readUInt16LE(localOffset + 8) !== 0) problems.push(`zip local 压缩方法非 store: ${name}`);
    if (bytes.readUInt16LE(localOffset + 10) !== DOS_TIME
      || bytes.readUInt16LE(localOffset + 12) !== DOS_DATE) {
      problems.push(`zip local 时间戳非固定值: ${name}`);
    }
    if (bytes.readUInt32LE(localOffset + 14) !== crc) problems.push(`zip local crc 不一致: ${name}`);
    if (bytes.readUInt32LE(localOffset + 18) !== compressedSize
      || bytes.readUInt32LE(localOffset + 22) !== uncompressedSize) {
      problems.push(`zip local 大小不一致: ${name}`);
    }
    const dataStart = localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (data.length !== compressedSize) problems.push(`zip 条目数据越界: ${name}`);
    if (crc32(data) !== crc) problems.push(`zip 条目 crc 校验失败: ${name}`);
    entries.push({ path: name, size: uncompressedSize, sha256: sha256Hex(data), data });
    cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralSize) problems.push("zip central directory 未被完整解析");
  return { problems, entries };
};

// ------------------------------------------------------------- owner receipts
const axisPathsFromArgs = (args) => ({
  runtime: { manifest: args.runtimeManifest, receipt: args.runtimeReceipt, root: args.runtimeRoot },
  content: { manifest: args.contentManifest, receipt: args.contentReceipt, root: args.contentRoot },
});

const ownerCommands = (axes) => {
  const commands = [];
  for (const axis of AXES) {
    for (const command of axes[axis].receipt.commands ?? []) {
      if (command && !commands.includes(command)) commands.push(command);
    }
  }
  return commands;
};

// manifest 只放跨 run 可复现的源事实：owner manifest 本身是确定性的；
// owner receipt 含 runUrl，只放进系统 receipt，避免 manifest 随 run 漂移。
const axisRecord = (axisData) => ({
  commit: axisData.commit,
  setHash: axisData.setHash,
  setHashNamespace: HASH_NAMESPACE,
  manifestSha256: axisData.manifestSha256,
  fileCount: axisData.files.length,
  bytes: axisData.bytesTotal,
  files: axisData.files,
});

const readUnionBytes = (axes, entries) => entries.map((entry) => {
  const root = entry.axis === "runtime" ? axes.runtime.root : axes.content.root;
  return { path: entry.path, bytes: readFileSync(join(root, entry.path)) };
});

// ------------------------------------------------------------------ assemble
const assemble = (args) => {
  if (!args.outDir) usage("assemble 需要 --out-dir");
  const paths = axisPathsFromArgs(args);
  const axes = {
    runtime: loadOwnerAxis("runtime", paths.runtime, paths.runtime.root),
    content: loadOwnerAxis("content", paths.content, paths.content.root),
  };
  const union = unionEntries(axes);
  const problems = [...union.problems, ...checkForbidden(union.entries, args.forbiddenPrefix)];

  const systemBytes = readFileSync(join(axes.runtime.root, "system.json"));
  const inspected = inspectSystem({
    systemBytes,
    runtimeFiles: axes.runtime.files,
    allFiles: union.entries,
    expectedSystemId: args.systemId,
  });
  problems.push(...inspected.problems);
  if (problems.length) fail(problems);

  // 两次独立构建必须逐字节一致。
  const zipFirst = makeZip(readUnionBytes(axes, union.entries));
  const zipSecond = makeZip(readUnionBytes(axes, union.entries));
  if (!zipFirst.equals(zipSecond)) fail(["两次构建的 system.zip 字节不一致"]);
  const zipBytes = zipFirst;

  const outDir = resolve(args.outDir);
  const zipPath = join(outDir, ZIP_FILE);
  const manifestPath = join(outDir, ARTIFACT_MANIFEST_FILE);
  const receiptPath = join(outDir, ARTIFACT_RECEIPT_FILE);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(zipPath, zipBytes);

  const artifact = {
    path: ZIP_FILE,
    sha256: sha256Hex(zipBytes),
    size: zipBytes.length,
    fileCount: union.entries.length,
    bytes: union.entries.reduce((sum, entry) => sum + entry.size, 0),
    zipRecipe: ZIP_RECIPE,
    layout: "system-root",
  };
  const manifest = {
    schema: MANIFEST_SCHEMA,
    system: inspected.system,
    artifact,
    binding: {
      runtimeCommit: axes.runtime.commit,
      contentCommit: axes.content.commit,
      runtimeSetHash: axes.runtime.setHash,
      contentSetHash: axes.content.setHash,
      artifactSha256: artifact.sha256,
    },
    axes: {
      runtime: axisRecord(axes.runtime),
      content: axisRecord(axes.content),
    },
    notices: inspected.notices,
    forbiddenPrefixes: [...args.forbiddenPrefix],
    generatedBy: TOOL,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(manifestPath, manifestBytes);

  const receipt = {
    schema: RECEIPT_SCHEMA,
    kind: "system-artifact",
    system: { id: inspected.system.id, version: inspected.system.version },
    result: "passed",
    runUrl: args.runUrl ?? null,
    commands: [
      ...ownerCommands(axes),
      "node tools/owner-ci/artifact.mjs verify --artifact system.zip "
        + "--manifest system-manifest.json --receipt system-receipt.json",
    ],
    manifest: ARTIFACT_MANIFEST_FILE,
    manifestSha256: sha256Hex(manifestBytes),
    axes: {
      runtime: {
        commit: axes.runtime.commit,
        setHash: axes.runtime.setHash,
        manifestSha256: axes.runtime.manifestSha256,
        receiptSha256: axes.runtime.receiptSha256,
        fileCount: axes.runtime.files.length,
      },
      content: {
        commit: axes.content.commit,
        setHash: axes.content.setHash,
        manifestSha256: axes.content.manifestSha256,
        receiptSha256: axes.content.receiptSha256,
        fileCount: axes.content.files.length,
      },
    },
    artifact: {
      path: ZIP_FILE,
      sha256: artifact.sha256,
      size: artifact.size,
      fileCount: artifact.fileCount,
      bytes: artifact.bytes,
    },
    generatedBy: TOOL,
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  // assemble 自身再跑一次完整 verify（含从源树重建 zip 的字节对照）。
  verifyArtifact({
    artifactPath: zipPath,
    manifestPath,
    receiptPath,
    runtimeRoot: axes.runtime.root,
    contentRoot: axes.content.root,
    ownerPaths: {
      runtime: { manifest: paths.runtime.manifest, receipt: paths.runtime.receipt },
      content: { manifest: paths.content.manifest, receipt: paths.content.receipt },
    },
    expectedSystemId: args.systemId,
  }, false);

  console.log(JSON.stringify({
    system: { id: inspected.system.id, version: inspected.system.version },
    artifact: artifact.sha256,
    artifactSize: artifact.size,
    fileCount: artifact.fileCount,
    runtime: { commit: axes.runtime.commit, setHash: axes.runtime.setHash, files: axes.runtime.files.length },
    content: { commit: axes.content.commit, setHash: axes.content.setHash, files: axes.content.files.length },
    zip: zipPath,
    manifest: manifestPath,
    receipt: receiptPath,
    runUrl: receipt.runUrl,
  }, null, 2));
};

// -------------------------------------------------------------------- verify
const verifyAxisBinding = (axis, record, problems) => {
  if (!record || typeof record !== "object") {
    problems.push(`${axis}: manifest 缺少轴记录`);
    return;
  }
  if (!isFullCommit(record.commit)) problems.push(`${axis}: commit 不是完整 40 位`);
  if (!isSha256(record.setHash)) problems.push(`${axis}: setHash 非法`);
  if (record.setHashNamespace !== HASH_NAMESPACE) {
    problems.push(`${axis}: setHashNamespace ${record.setHashNamespace} != ${HASH_NAMESPACE}`);
  }
  if (!isSha256(record.manifestSha256)) problems.push(`${axis}: manifestSha256 非法`);
  const files = Array.isArray(record.files) ? record.files : [];
  if (record.fileCount !== files.length) problems.push(`${axis}: fileCount 与 files 长度不一致`);
  if (record.setHash !== canonicalSetHash(files)) {
    problems.push(`${axis}: setHash 与 files 重新计算结果不符`);
  }
  for (let i = 0; i < files.length; i += 1) {
    const entry = files[i];
    if (!entry || typeof entry.path !== "string" || !entry.path
      || !Number.isInteger(entry.size) || entry.size < 0 || !isSha256(entry.sha256)) {
      problems.push(`${axis}: files[${i}] 字段非法`);
      continue;
    }
    if (i > 0 && byPath(files[i - 1], entry) >= 0) {
      problems.push(`${axis}: files 未按 path 严格升序或存在重复: ${entry.path}`);
    }
  }
};

const verifySourceAxis = (axis, record, root) => {
  const problems = [];
  const commit = resolveCommit(root, record.commit);
  const head = gitText(root, ["rev-parse", "HEAD"]);
  if (head !== commit) problems.push(`${axis}: root HEAD ${head} != commit ${commit}`);
  const fromGit = setFromGit(root, axis, commit);
  const expected = new Map(fromGit.entries.map((entry) => [entry.path, entry]));
  const recorded = new Map(record.files.map((entry) => [entry.path, entry]));
  for (const [path, entry] of expected) {
    if (!recorded.has(path)) problems.push(`${axis}: manifest 缺少集合内文件: ${path}`);
    const listed = recorded.get(path);
    if (listed && (listed.size !== entry.size || listed.sha256 !== entry.sha256)) {
      problems.push(`${axis}: manifest 记录与 git 对象不符: ${path}`);
    }
  }
  for (const path of recorded.keys()) {
    if (!expected.has(path)) problems.push(`${axis}: manifest 多出集合外文件: ${path}`);
  }
  if (fromGit.setHash !== record.setHash) problems.push(`${axis}: git 集合 hash != manifest setHash`);
  for (const entry of record.files) {
    let bytes;
    try {
      bytes = readFileSync(join(root, entry.path));
    } catch {
      problems.push(`${axis}: 集合内文件缺失: ${entry.path}`);
      continue;
    }
    if (bytes.length !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      problems.push(`${axis}: 工作树字节与 manifest 不符: ${entry.path}`);
    }
  }
  const dirty = dirtyStatus(root);
  if (dirty) {
    const inScope = dirty.split("\n").filter((line) => {
      const path = line.slice(3).trim().replace(/^"|"$/g, "");
      return inSet(axis, path);
    });
    if (inScope.length) problems.push(`${axis}: 集合范围内工作树漂移: ${inScope.slice(0, 8).join(" | ")}`);
  }
  return problems;
};

const verifyArtifact = (options, print = true) => {
  const problems = [];
  const artifactBytes = (() => {
    try {
      return readFileSync(options.artifactPath);
    } catch (error) {
      return fail([`artifact 无法读取: ${error.message}`]);
    }
  })();
  const manifestFile = readJsonFile(options.manifestPath, "system manifest", problems);
  const receiptFile = readJsonFile(options.receiptPath, "system receipt", problems);
  if (problems.length) fail(problems);
  const manifest = manifestFile.json;
  const receipt = receiptFile.json;

  if (manifest.schema !== MANIFEST_SCHEMA) {
    problems.push(`manifest.schema ${manifest.schema} != ${MANIFEST_SCHEMA}`);
  }
  if (receipt.schema !== RECEIPT_SCHEMA) {
    problems.push(`receipt.schema ${receipt.schema} != ${RECEIPT_SCHEMA}`);
  }
  if (receipt.kind !== "system-artifact") problems.push(`receipt.kind ${receipt.kind} != system-artifact`);
  if (receipt.result !== "passed") problems.push(`receipt.result=${receipt.result}，非绿结果不得通过 verify`);
  if (receipt.manifestSha256 !== sha256Hex(manifestFile.bytes)) {
    problems.push("receipt.manifestSha256 与 manifest 实际字节不符");
  }
  if (!Array.isArray(receipt.commands) || receipt.commands.length === 0) {
    problems.push("receipt.commands 为空");
  }
  if (receipt.runUrl !== null && typeof receipt.runUrl !== "string") {
    problems.push("receipt.runUrl 必须是 null 或字符串");
  }

  const artifact = manifest.artifact ?? {};
  if (artifact.path !== ZIP_FILE) problems.push(`manifest.artifact.path ${artifact.path} != ${ZIP_FILE}`);
  if (artifact.sha256 !== sha256Hex(artifactBytes)) {
    problems.push(`manifest.artifact.sha256 与 zip 实际字节不符: ${artifact.sha256}`);
  }
  if (artifact.size !== artifactBytes.length) {
    problems.push(`manifest.artifact.size ${artifact.size} != zip 实际大小 ${artifactBytes.length}`);
  }
  if (artifact.zipRecipe !== ZIP_RECIPE) problems.push("manifest.artifact.zipRecipe 与本工具 recipe 不符");

  const binding = manifest.binding ?? {};
  if (binding.runtimeCommit !== manifest.axes?.runtime?.commit) {
    problems.push("manifest.binding.runtimeCommit 与 axes.runtime.commit 不一致");
  }
  if (binding.contentCommit !== manifest.axes?.content?.commit) {
    problems.push("manifest.binding.contentCommit 与 axes.content.commit 不一致");
  }
  if (binding.runtimeSetHash !== manifest.axes?.runtime?.setHash) {
    problems.push("manifest.binding.runtimeSetHash 与 axes.runtime.setHash 不一致");
  }
  if (binding.contentSetHash !== manifest.axes?.content?.setHash) {
    problems.push("manifest.binding.contentSetHash 与 axes.content.setHash 不一致");
  }
  if (binding.artifactSha256 !== artifact.sha256) {
    problems.push("manifest.binding.artifactSha256 与 artifact.sha256 不一致");
  }

  const system = manifest.system ?? {};
  if (system.id !== options.expectedSystemId) {
    problems.push(`manifest.system.id ${system.id} != 期望 ${options.expectedSystemId}`);
  }

  const axes = manifest.axes ?? {};
  for (const axis of AXES) verifyAxisBinding(axis, axes[axis], problems);
  if (problems.length) fail(problems);

  const union = unionEntries({
    runtime: { files: axes.runtime.files },
    content: { files: axes.content.files },
  });
  problems.push(...union.problems);
  // 默认禁用的派生目录不可被 manifest 关闭；只允许额外追加禁项。
  const forbiddenPrefixes = Array.isArray(manifest.forbiddenPrefixes) ? manifest.forbiddenPrefixes : [];
  problems.push(...checkForbidden(union.entries,
    [...new Set([...DEFAULT_FORBIDDEN_PREFIXES, ...forbiddenPrefixes])]));
  if (artifact.fileCount !== union.entries.length) {
    problems.push(`manifest.artifact.fileCount ${artifact.fileCount} != 两轴文件数 ${union.entries.length}`);
  }
  const bytesTotal = union.entries.reduce((sum, entry) => sum + entry.size, 0);
  if (artifact.bytes !== bytesTotal) problems.push(`manifest.artifact.bytes ${artifact.bytes} != ${bytesTotal}`);

  const zip = readZip(artifactBytes);
  problems.push(...zip.problems);
  const expected = new Map(union.entries.map((entry) => [entry.path, entry]));
  const actual = new Map();
  for (const entry of zip.entries) {
    if (actual.has(entry.path)) problems.push(`zip 含重复路径: ${entry.path}`);
    actual.set(entry.path, entry);
  }
  for (const [path, entry] of expected) {
    const packed = actual.get(path);
    if (!packed) {
      problems.push(`zip 缺少文件: ${path}`);
    } else if (packed.size !== entry.size || packed.sha256 !== entry.sha256) {
      problems.push(`zip 字节与 manifest 不符: ${path}`);
    }
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) problems.push(`zip 多出 manifest 外文件: ${path}`);
  }
  const sortedPaths = union.entries.map((entry) => entry.path);
  const zipPaths = zip.entries.map((entry) => entry.path);
  if (JSON.stringify(zipPaths) !== JSON.stringify(sortedPaths)) {
    problems.push("zip 条目次序不是 manifest 的 path 升序");
  }

  const systemPacked = actual.get("system.json");
  let inspected = { problems: ["zip 缺少 system.json"], system: null, notices: [] };
  if (systemPacked) {
    inspected = inspectSystem({
      systemBytes: systemPacked.data,
      runtimeFiles: axes.runtime.files,
      allFiles: union.entries,
      expectedSystemId: options.expectedSystemId,
    });
    problems.push(...inspected.problems);
    const expectedSystemKeys = ["id", "version", "title", "hostGeneration", "hostVersionVerified", "entryPoints", "license", "changelog"];
    for (const key of expectedSystemKeys) {
      if (JSON.stringify(inspected.system?.[key] ?? null) !== JSON.stringify(system[key] ?? null)) {
        problems.push(`manifest.system.${key} 与 system.json 不符`);
      }
    }
    const expectedCompatibility = inspected.system?.hostCompatibility ?? null;
    if (JSON.stringify(expectedCompatibility) !== JSON.stringify(system.hostCompatibility ?? null)) {
      problems.push("manifest.system.hostCompatibility 与 system.json 不符");
    }
  }

  const notices = Array.isArray(manifest.notices) ? manifest.notices : [];
  const noticeByPath = new Map(notices.map((notice) => [notice.path, notice]));
  for (const expectedNotice of inspected.notices) {
    const recordedNotice = noticeByPath.get(expectedNotice.path);
    if (!recordedNotice) {
      problems.push(`manifest.notices 缺少: ${expectedNotice.path}`);
    } else if (recordedNotice.size !== expectedNotice.size || recordedNotice.sha256 !== expectedNotice.sha256) {
      problems.push(`manifest.notices 与产物字节不符: ${expectedNotice.path}`);
    }
  }
  const expectedNoticePaths = new Set(inspected.notices.map((notice) => notice.path));
  for (const path of noticeByPath.keys()) {
    if (!expectedNoticePaths.has(path)) problems.push(`manifest.notices 多出非必需项: ${path}`);
  }

  if (receipt.system?.id !== system.id || receipt.system?.version !== system.version) {
    problems.push("receipt.system 与 manifest.system 不一致");
  }
  for (const axis of AXES) {
    const record = axes[axis];
    const receiptAxis = receipt.axes?.[axis] ?? {};
    for (const key of ["commit", "setHash", "manifestSha256", "fileCount"]) {
      if (receiptAxis[key] !== record[key]) {
        problems.push(`receipt.axes.${axis}.${key} 与 manifest 不一致`);
      }
    }
    if (!isSha256(receiptAxis.receiptSha256)) {
      problems.push(`receipt.axes.${axis}.receiptSha256 非法`);
    }
  }
  const receiptArtifact = receipt.artifact ?? {};
  for (const key of ["path", "sha256", "size", "fileCount", "bytes"]) {
    if (receiptArtifact[key] !== artifact[key]) {
      problems.push(`receipt.artifact.${key} 与 manifest 不一致`);
    }
  }

  // 有源树时做最严格的一步：把 manifest 的文件集与 git 对象/工作树逐字节
  // 对齐，再从源树重建 zip，要求与提交的 artifact 逐字节一致。
  const hasRoots = Boolean(options.runtimeRoot || options.contentRoot);
  if (hasRoots && !(options.runtimeRoot && options.contentRoot)) {
    problems.push("verify 需要同时提供 --runtime-root 与 --content-root");
  }
  const ownerPaths = options.ownerPaths ?? {};
  const hasOwnerManifests = AXES.some((axis) => ownerPaths[axis]?.manifest || ownerPaths[axis]?.receipt);
  if (hasOwnerManifests) {
    const incomplete = AXES.filter((axis) => !ownerPaths[axis]?.manifest || !ownerPaths[axis]?.receipt);
    if (incomplete.length) problems.push(`verify 缺少 ${incomplete.join("/")} 的 owner manifest/receipt`);
  }
  if (options.runtimeRoot && options.contentRoot) {
    for (const axis of AXES) {
      problems.push(...verifySourceAxis(axis, axes[axis], axis === "runtime" ? options.runtimeRoot : options.contentRoot));
    }
    if (hasOwnerManifests && !problems.length) {
      for (const axis of AXES) {
        const owner = loadOwnerAxis(axis,
          { manifest: ownerPaths[axis].manifest, receipt: ownerPaths[axis].receipt },
          axis === "runtime" ? options.runtimeRoot : options.contentRoot);
        if (owner.commit !== axes[axis].commit) problems.push(`${axis}: owner commit 与 artifact manifest 不一致`);
        if (owner.setHash !== axes[axis].setHash) problems.push(`${axis}: owner setHash 与 artifact manifest 不一致`);
        if (owner.manifestSha256 !== axes[axis].manifestSha256) {
          problems.push(`${axis}: owner manifestSha256 与 artifact manifest 不一致`);
        }
        if (owner.receiptSha256 !== receipt.axes?.[axis]?.receiptSha256) {
          problems.push(`${axis}: owner receiptSha256 与 artifact receipt 不一致`);
        }
        if (JSON.stringify(owner.files) !== JSON.stringify(axes[axis].files)) {
          problems.push(`${axis}: owner 文件集与 artifact manifest 不一致`);
        }
      }
    }
    const rebuilt = makeZip(union.entries.map((entry) => ({
      path: entry.path,
      bytes: readFileSync(join(entry.axis === "runtime" ? options.runtimeRoot : options.contentRoot, entry.path)),
    })));
    if (!rebuilt.equals(artifactBytes)) {
      problems.push("从源树重建的 zip 与 artifact 不是逐字节一致");
    }
  }

  if (problems.length) fail(problems);
  if (print) {
    console.log(JSON.stringify({
      system: { id: system.id, version: system.version },
      artifact: artifact.sha256,
      artifactSize: artifact.size,
      fileCount: artifact.fileCount,
      runtime: { commit: axes.runtime.commit, setHash: axes.runtime.setHash, files: axes.runtime.files.length },
      content: { commit: axes.content.commit, setHash: axes.content.setHash, files: axes.content.files.length },
      rebuild: options.runtimeRoot && options.contentRoot ? "byte-identical" : "skipped",
      result: "verified",
    }, null, 2));
  }
  return true;
};

const verify = (args) => {
  const missing = [];
  if (!args.artifact) missing.push("--artifact");
  if (!args.manifest) missing.push("--manifest");
  if (!args.receipt) missing.push("--receipt");
  if (missing.length) usage(`verify 缺少 ${missing.join(" ")}`);
  const paths = axisPathsFromArgs(args);
  verifyArtifact({
    artifactPath: args.artifact,
    manifestPath: args.manifest,
    receiptPath: args.receipt,
    runtimeRoot: args.runtimeRoot,
    contentRoot: args.contentRoot,
    ownerPaths: {
      runtime: { manifest: paths.runtime.manifest, receipt: paths.runtime.receipt },
      content: { manifest: paths.content.manifest, receipt: paths.content.receipt },
    },
    expectedSystemId: args.systemId,
  }, true);
};

const main = () => {
  const [mode, ...rest] = process.argv.slice(2);
  try {
    if (mode === "assemble") assemble(parseArgs(rest));
    else if (mode === "verify") verify(parseArgs(rest));
    else usage(mode ? `未知子命令 ${mode}` : "缺少子命令");
  } catch (error) {
    fail([error.message]);
  }
};

// 与 manifest.mjs 相同的 realpath 直调守卫：经符号链接调用也必须真的执行，
// 不能因 argv 与 import.meta.url 的 realpath 差异静默 exit 0（fail-open）。
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) main();

export { makeZip, readZip, sha256Hex };
