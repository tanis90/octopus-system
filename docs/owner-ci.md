# Owner CI（源仓自有验收）

本文描述 `octopus-system` 源仓的 owner CI：两条互相独立的验收线，分别对应
**BRP 运行集**与**旧 M8 内容集**，各自出 manifest + receipt。工作流在
`.github/workflows/owner-ci.yml`，出证工具在 `tools/owner-ci/manifest.mjs`。

## 为什么要分两条线

- **运行集（runtime）**：`module/`、`templates/`、`lang/`、`css/` 等被前端
  兼容层随运行时一起带走的源文件。它的 provenance 锚点是**当前源 main**。
- **内容集（content）**：`packs/`、`packs-index/`、`packs-json/` 的已发布
  基线。它的 provenance 锚点是**已发布组合**（当前钉在旧 M8 内容集
  `95d984dbc64a0d5631f736bda7bb613ce98128cf`），不是 main。

两者锚点不同，所以不能用一个 commit、也不能用同一次 checkout 验收。
main 上的内容漂移不会被 CI 悄悄当成升级：content job 永远测试
`tools/owner-ci/content-pin.json` 钉住的 commit；升级内容必须显式修改该
文件（并重新计算集合 hash），否则 CI 按红处理。

## file set 规则（可复现，无魔法数字）

两个集合都从 `git ls-tree -r --full-tree <testedCommit>` 推导：

| kind | 集合 | 268211e / 95d984d 实测 |
| --- | --- | --- |
| `runtime` | 全部 tracked 文件，剔除内容产物目录 `packs/`、`packs-index/`、`packs-json/`，以及 owner CI 自有文件 `.github/`、`tools/owner-ci/`、`tools/tests/owner-ci-verify-negative.mjs`、`docs/owner-ci.md` | 329 文件 |
| `content` | 位于 `packs/`、`packs-index/`、`packs-json/` 之下的 tracked 文件 | 362 文件 |

owner CI 自身的排除项是精确路径/目录：这些文件合入源仓与否不改变部署运行面
的集合口径（329 不会因 CI 工具/文档合入而变成别的数字）。真实仓文件的修改
不被排除项掩盖——例如 `Readme.md`、`CHANGELOG.md` 的改动仍留在 runtime 集合
里，按漂移对待。

逐文件记录 `path` / `size` / `sha256`（工作树字节，且与 git blob 逐字节
核对）。集合 hash 算法：

```
sha256( "${path}\n${size}\n${sha256hex}\n" 逐条拼接 )
```

条目按 path 升序（UTF-16 code unit 序）排列。算法与当前钉住基线的实测值
都记录在 `content-pin.json`（`contentSetHashAlgo` / `contentSetHashSha256`）。
**命名空间**：本工具的 `setHash` / `artifactHash` 属于
`octopus-owner-ci-set-hash/1`（manifest 的 `hashNamespace` 字段），与前端
`live-file-set-v1` 台账 hash 是不同命名空间；后续做前端 `ci.binds.artifactHash`
映射时只能消费 receipt 的 `artifactHash` 字段，不得把两个命名空间的 hash
互认或互算。

## 出证工具

```bash
# 对被测 checkout 出证（HEAD 必须等于 --commit，集合内每个文件的工作树字节
# 必须与 git blob 一致；否则非零退出）。--root 指向被测 checkout，
# 工具本身可以从任意工作副本调用（见下方“本地验收”）。
node tools/owner-ci/manifest.mjs collect \
  --kind runtime --commit <rev> --root <被测checkout目录> \
  --out <manifest.json> --receipt <receipt.json> \
  [--run-url <url>] [--expect-set-hash <hex>] [--command <cmd>]...

# 复核 receipt↔manifest 绑定（manifestSha256/setHash/artifactHash）、
# 集合 hash、HEAD 绑定、逐文件 hash、集合范围漂移
node tools/owner-ci/manifest.mjs verify \
  --manifest <path> --receipt <path> [--root <dir>]

# 直接从 git 对象计算集合 hash（不要求 root 停在该 commit）
node tools/owner-ci/manifest.mjs set-hash --kind content --commit <rev>
```

- receipt 记录 `testedCommit`、`commands`（实际执行的测试命令）、`runUrl`、
  `result`，并用 `manifestSha256` 绑定 manifest 字节；`setHash` 与
  `artifactHash` 是同一集合 hash 的双字段（后者供前端 strict
  `ci.binds.artifactHash` 直接消费），verify 强校验两者都与 manifest 一致。
  本地出证 `runUrl: null`；CI 全绿后的 collect 步骤才写入真实 run URL。
- `verify` 是 fail-closed 的：任一缺件、字节漂移、集合外多文件、HEAD 漂移、
  receipt/manifest 绑定断裂（含 `artifactHash`）、`result != passed` 都非零
  退出。负例覆盖见 `tools/tests/owner-ci-verify-negative.mjs`（改字节/缺件/
  集合漂移/commit 漂移/manifest 篡改/非绿 receipt/artifactHash 篡改七类）。
- manifest 只描述**本源仓 git 树**，不含任何前端仓或台账目录的 hash；
  前端侧的逐字节对照是验收手段，不进入源仓 provenance。

## CI 两条 job

**runtime job**（被测 ref：push/PR = 触发时的当前源；dispatch 可用
`inputs.runtimeRef` 复核历史）：

1. checkout 被测源 + 按 pin checkout 分发仓
   `tanis90/arcane-investigator-options`；
2. 按文档化流程把扩展从主仓 facts 重建进分发仓 checkout，并把重建差异
   写进 job summary（informational，不阻塞）；
3. 跑源仓语义测试（在被测 `src` 树内执行其自带的脚本）：
   ```bash
   node tools/check-zh-cn.mjs
   node tools/tests/base-pack-determinism.mjs
   node tools/tests/coc-sanity-regressions.mjs
   node tools/tests/coc-rules-regressions.mjs
   node "$GITHUB_WORKSPACE/owner-meta/tools/tests/owner-ci-verify-negative.mjs"
   ```
4. 全绿后 collect + verify runtime manifest/receipt（工具从 owner-meta 调用，
   `--root` 指向被测 src），上传 artifact。

**owner-meta 模式**：出证工具、负例脚本与 pin 一律从 owner-meta
（`github.sha` = workflow 自身源树）调用，root 指向被测 checkout。因此被测
ref 可以是任何历史 commit——包括完全不含 owner CI 工具的树（如 268211e），
runtime/content 两路历史复核都不依赖被测树携带这些工具。

**content job**（被测 ref：`inputs.contentRef`，缺省 = pin 钉住的已发布
基线）：

1. checkout 钉住的内容 commit（`actions/checkout` 的 `ref`）；
2. 跑该 commit 自带的内容/包构建与确定性测试：
   ```bash
   node tools/base-pack/build.mjs
   node tools/coc-pack/build.mjs
   node tools/tests/base-pack-determinism.mjs
   node tools/tests/coc-rules-regressions.mjs
   node tools/tests/coc-sanity-regressions.mjs
   git diff --exit-code   # 重建 == 已提交字节（确定性口径）
   ```
3. 全绿后 collect（带 `--expect-set-hash` 对照 pin 里的基线 hash）+ verify，
   上传 artifact。

CI 只上传 manifest/receipt artifacts：不自动 Release、不推回
（所有 checkout 都 `persist-credentials: false`）。

## 本地验收（已执行的口径；不需要 commit）

验收在**临时 detached checkout** 上完成，本仓工作树保持未提交改动即可，
不要求也不允许为出证而 commit。出证工具从工作副本（owner-meta 等价物）调用，
`--root` 指向被测 checkout：

```bash
# 0) 被测 ref 的临时 checkout（detached，用完即删）
git worktree add --detach /tmp/os-main 268211ebb73d39b7157d3fd4efc3f191b57e109a
git worktree add --detach /tmp/os-m8   95d984dbc64a0d5631f736bda7bb613ce98128cf

# 1) 运行集：语义测试在被测树内跑
cd /tmp/os-main
node tools/check-zh-cn.mjs
node tools/tests/base-pack-determinism.mjs
node tools/tests/coc-sanity-regressions.mjs
node tools/tests/coc-rules-regressions.mjs   # 先按 pin 的 expansionRef 重建分发仓 checkout
node <工作副本>/tools/tests/owner-ci-verify-negative.mjs   # owner 工具从工作副本调用

# 2) 运行集出证（工具从工作副本调用，root 指向被测 checkout）
node <工作副本>/tools/owner-ci/manifest.mjs collect \
  --kind runtime --commit 268211ebb73d39b7157d3fd4efc3f191b57e109a \
  --root /tmp/os-main \
  --out tools/owner-ci/artifacts/runtime-manifest.json \
  --receipt tools/owner-ci/artifacts/runtime-receipt.json \
  --command "node tools/check-zh-cn.mjs" ...

# 3) 内容集：双构建 + 确定性 + 语义测试在被测树内跑
cd /tmp/os-m8
node tools/base-pack/build.mjs && node tools/coc-pack/build.mjs && git diff --exit-code
node tools/tests/base-pack-determinism.mjs
node tools/tests/coc-rules-regressions.mjs
node tools/tests/coc-sanity-regressions.mjs

# 4) 内容集出证（--expect-set-hash 对照 pin）+ 两路 verify
node <工作副本>/tools/owner-ci/manifest.mjs collect \
  --kind content --commit 95d984dbc64a0d5631f736bda7bb613ce98128cf \
  --root /tmp/os-m8 \
  --expect-set-hash $(node -p "require('./tools/owner-ci/content-pin.json').contentSetHashSha256") \
  --out tools/owner-ci/artifacts/content-manifest.json \
  --receipt tools/owner-ci/artifacts/content-receipt.json \
  --command "node tools/base-pack/build.mjs" ...
```

出证产物落在 `tools/owner-ci/artifacts/`（runtime/content 各一对），当前以
**未提交改动**状态保存。receipt 的 `runUrl` 为 `null`：本地没有 CI run，
不得声称已有 CI。临时 checkout 用完即删：
`git worktree remove /tmp/os-main && git worktree remove /tmp/os-m8 && git worktree prune`。

## 内容升级流程（显式，不做静默升级）

1. 在新的内容 commit 上重跑内容测试并出证；
2. 用 `node tools/owner-ci/manifest.mjs set-hash --kind content --commit <new>`
   计算新集合 hash；
3. 修改 `tools/owner-ci/content-pin.json`：`contentRef`、
   `contentSetHashSha256` 同步更新，并在 `contentRefNote` 写明新基线；
4. CI 的 content job 即按新基线验收；旧基线可用
   `workflow_dispatch` + `inputs.contentRef` 随时复核。

## 已知边界

- `tools/tests/coc-rules-regressions.mjs` 在主仓 main 上要求分发仓 checkout
  的扩展产物与主仓 facts 一致；已发布的分发仓（pinned expansionRef）仍是旧
  doc 形态，runtime job 按文档化流程先重建再测试，并把漂移写进 job summary。
  让已发布分发仓对齐主仓是分发仓自己的发布动作，不在 owner CI 内代劳。
- 需要 Foundry 运行时的探针（`rules-regressions.mjs`、`coc-paper-runtime.mjs`、
  `coc-window-controls.mjs`、`sanity-regressions.mjs`）依赖 compat 仓无头环境，
  不进源仓 CI；本仓 CI 覆盖的卡牌语义来自纯规则模块
  （`tools/tests/coc-rules-regressions.mjs` 的检定/战斗/成长/结算契约）。
- 本仓没有 package.json；owner CI 全部直接用 node + git，不引入依赖。
