# AGENTS.md — BRP system owner 仓

本仓是 `brp` system（章鱼料理研究会）的 owner/source of truth：BRP 规则语义、系统接口、内容闭包、发布证据与 owner CI。前端仓（`mt-foundry-compat` / `web/packages/brp`）的总协作规则见其自己的 `AGENT.md`；本文件只约束 owner 仓的源码、证据和发布边界，不重复前端规则。

## 职责与协作顺序

- owner 负责：规则语义（`module/rules/`、检定/战斗/SAN/Luck/创建等）、系统接口（`system.json`、`template.json`、入口/语言/样式/文档类型）、内容闭包（`content/` → `packs*`）和 CI 验证。
- 前端只负责依赖身份、结构校验与宿主集成：安装/加载 system、核对 artifact 的 commit/setHash/zip hash、跑宿主侧测试。前端不得替 owner 验全量规则语义，不得从 `web/packages/brp` 的重建物冒充 owner artifact，也不得把前端 `live-file-set-v1` 台账 hash 当作 owner hash。
- 正常顺序：owner 源码/内容改动并通过本地验证 → owner CI 两轴全绿并产出 artifact → 前端 pin/adopt 该 artifact。前端不得先改 pin 再等 owner 补证。
- `octopus` 与 `coc7` 共用 `brp` system（同 id、同宿主入口），但不是同一 ruleset、不是同一战役：规则分支、starter/内容包、迁移语义分线维护，不得互相覆盖。
- ruleset 是创建战役时固定的分类，不随 system 发版改变。除非确实破坏后端 API/数据契约，不修改后端或迁移战役；宿主代际变化须另立规则与发布线。UI 偏好、卡面审美、前端交互不进 release 身份。

## 发布身份与证据

- runtime 与 content 是两个独立轴，各自必须有完整 commit、file set、`octopus-owner-ci-set-hash/1` setHash 和 receipt；不得合并成单一“系统版本”。
- 轴身份只认不可变引用：tag 优先，否则完整 40 位 commit。禁 `main`/`latest`/短 hash/branch 名/日期；`system.json` 的 `version`（当前 `0.3.1-dev`）是宿主显示版本，不是不可变 release 身份。
- runtime set = `git ls-tree -r --full-tree <runtimeCommit>` 剔除 `packs/`、`packs-index/`、`packs-json/` 与 owner-only 路径（`.github/`、`tools/owner-ci/`、两个 owner 负例脚本、`docs/owner-ci.md`）；content set = 各自固定 contentCommit 中 `packs*` 下 tracked 文件。精确规则以 `tools/owner-ci/manifest.mjs` 为准，不得口算或自造。
- content 升级必须显式改 `tools/owner-ci/content-pin.json` 的 `contentRef`，并用 `manifest.mjs set-hash` 重算 `contentSetHashSha256`；main 的内容漂移不得被当成升级，content job 也不得偷偷跟随 runtime commit。
- 真实 run 的 receipt 必须记录实际执行命令、`result`、`manifestSha256`、setHash 与 runUrl；本地出证 `runUrl: null`，不得伪造 CI URL。
- 区分 sourceCommit 与 testedCommit：push 的 testedCommit 是源 commit；PR 触发时 workflow checkout 的是 GitHub 合成的 merge commit，receipt 的 `testedCommit` 记录这个实际 checkout，不等于 PR head/sourceCommit。不得把 merge commit 当发布源码，也不得声称 PR head 被直接测试；dispatch 的 testedCommit 是 `runtimeRef`/`contentRef` 解析后的 commit。
- zip sha256（`artifact.sha256`）、system-manifest sha256、system-receipt sha256、两轴 manifest/receipt sha256、两轴 setHash 是不同字段，逐一保留；不得只留一个“总 hash”或用其中一个替代另一个。

## Artifact 契约

- 只从 owner CI 两轴的 manifest + receipt 组装：`tools/owner-ci/artifact.mjs assemble`，产出 `system.zip`、`system-manifest.json`、`system-receipt.json`；布局为 `system-root`（`system.json` 在 zip 根）。
- 固定 recipe `octopus-system-artifact-zip/1`：store 无压缩、路径 code-unit 升序、固定 1980-01-01 时间戳、0644、UTF-8 文件名；同输入两次构建必须逐字节一致。改 recipe 是发布格式变更，必须显式改常量并全量复核，不能静默漂移。
- 入口与许可由产物内 `system.json` 驱动：`esmodules`、styles、languages、packs、license、changelog 声明的路径必须存在且在正确轴；`LICENSE.txt` 与 `ORC-NOTICE.md` 必须存在且非空。缺件按失败处理，不生成占位文件。
- zip 内每个文件的 path/size/sha256 必须能在 system-manifest 与两轴 owner manifest 中复核；`artifact.mjs verify` 要同时校验 zip↔manifest↔receipt↔两轴源 commit，并从两轴源树重建 zip 做逐字节比对。
- 不得纳入没有源 commit 与许可证明的派生文件。历史 `modules/arcane-investigator-options/` 的 187 个文件因无源仓 commit 证明被拒，这是 provenance 反例，不是“该目录永久禁止”的语义；将来若要纳入，必须先给出源 commit、许可、逐文件 hash 与明确的 recipe 变更并经过 owner 评审，不能从旧前端产物直接拷贝。
- 同一 release 身份只对应一份字节：禁止用同一 tag/commit/release 覆盖不同字节的 zip、manifest 或 receipt；修复必须出新身份。保留旧 artifact 供回滚，不删除、不原地替换。

## 验证与 CI

- 本源仓没有 `package.json`、没有 `go.mod`：`npm test`、`go test` 均不适用；不要新增或假设 npm scripts，验证入口是 Node 脚本和 `.github/workflows/owner-ci.yml`。
- runtime 语义（与 owner CI 同款）：`node tools/check-zh-cn.mjs`；`node tools/tests/base-pack-determinism.mjs`；`node tools/tests/coc-sanity-regressions.mjs`；`node tools/tests/coc-rules-regressions.mjs`（需按 pin 的 `expansionRef` 准备 `ARCANE_INVESTIGATOR_OPTIONS_DIR`）；`node tools/tests/owner-ci-verify-negative.mjs`。
- content 轴：`node tools/base-pack/build.mjs`；`node tools/coc-pack/build.mjs`；`node tools/tests/base-pack-determinism.mjs`；`node tools/tests/coc-rules-regressions.mjs`；`node tools/tests/coc-sanity-regressions.mjs`；最后 `git diff --exit-code` 证明重建字节等于已提交字节。
- artifact 轴：`node tools/tests/owner-ci-artifact-negative.mjs`；再跑 `artifact.mjs assemble` 和 `artifact.mjs verify`（带两轴 root 与 owner manifest/receipt），verify 必须报 `rebuild: byte-identical`。
- 本地出证时 `manifest.mjs collect/verify` 的 `--root` 指向被测 checkout；工具本身可从 owner-meta/工作副本调用。只有真实 CI run 才写 runUrl。
- 本仓没有 `tools/run-headless.mjs`。Readme 里的 `MT_SYSTEM_ID=brp ... tools/run-headless.mjs` 是在 `mt-foundry-compat` 把本目录放进 `web/packages/brp/` 后的前端集成验证，不作为 owner 语义证据。
- 参考入口：`Readme.md`（开发/回归/owner CI 说明）、`.github/workflows/owner-ci.yml`（四个 job 的真源）、`tools/owner-ci/`（manifest/artifact/pin）、`system.json`（宿主接口与内容注册）、`docs/owner-ci.md`（规则与本地验收）。

## 交接与证据清单

- owner CI 的验收三 job（runtime 语义 + runtime manifest/receipt；content 验证 + content manifest/receipt；assemble + verify 出 `system.zip`、`system-manifest.json`、`system-receipt.json`）必须全绿。任一链路红都不得产出或消费 artifact，也不得进入发布 job。
- 交接/PR 除 receipt 的 testedCommit 外，必须另行注明 sourceCommit，并同时给出 runUrl、两轴 setHash 与 zip sha256；缺任一项视为证据不完整，不得只用“CI 绿了”代替。
- 分支/PR/dispatch 只上传私有 artifact，不推回；出证产物不写入 tracked dist 树，旧 artifact 保留供回滚。唯一对外写动作是 `release-publish`：仅 `release-*` tag push、且 tag commit 在 main 祖先线上时，把同一份三件上传为 GitHub Release（D2 坐标，D8 血统）；已存在的 release 不得覆盖，修复必须出新 tag。非 main 血统或非 `release-*` 的 tag 一律 fail-closed，不出件。
- `system.json` 是产物内唯一身份锚：entry、license、host generation 以它为准；manifest 只允许派生并复核，不另立常量或第二份身份表。
- 历史 PR/旧基线状态不写入本文件；以当前 workflow、tools 与 pin 为准。

## 禁止事项

- 禁止复制 Foundry 实现、未授权内容或他人模板/HTML/CSS/实现；只映射有许可的数值/名称并记录来源。
- 禁止伪造缺件（空文件、占位 pack、假入口、假 receipt、假 runUrl），或用 `0.3.1-dev` 冒充已发布版本。
- 禁止跨线全局资产倾轧：runtime/content 两轴、octopus/coc 两条 ruleset、不同 release 之间不得共享并覆盖同名产物；共享 system 不等于共享发布身份。
- 禁止绕过 owner CI 直接发布；禁止把前端重建、开发快照或未出证的 zip 当 owner artifact。
