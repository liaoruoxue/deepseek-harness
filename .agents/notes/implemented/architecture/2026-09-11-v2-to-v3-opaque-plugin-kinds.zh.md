# Agent Note: 插件定义的种类以所有者不透明 JSON 跨越 V2 到 V3 迁移边

Status: implemented

[English](2026-09-11-v2-to-v3-opaque-plugin-kinds.md) | 中文

## 问题

V2 到 V3 迁移的[源审计](../../../../packages/session/session-format-v2-to-v3/README.zh.md#source-audit)拒绝每个不在审计集合内的 message-source `kind` 和 content-block `type`。一个仓库外插件追加一条信息型 `user/message`，其 `source.kind` 为 `mcp-catalog`；升级后，报告者本地的 574 份 v0 Session 中有 552 份无法打开，每份都报 `cannot safely transform unclassified message source`（discussion #3191）。相同内容由同一套已安装 harness 写入并读取的 V3 Session 可原样加载。

链上其他位置都接受这些分支。[消息来源](../../../../packages/llm/llm/src/message.ts)与[内容块](../../../../packages/llm/llm/src/types.ts)是声明合并的映射，其类型明确要求按标签分支并让未知项落到默认分支；[Session append 校验](../../../../packages/core/session/src/index.ts)只要求非空字符串 kind。[V0 到 V1 迁移边](../../../../packages/session/session-format-v0-to-v1/src/payload-validation.ts)把未知的非空来源种类和内容块类型保留为所有者不透明 JSON，并由[其校验测试套件](../../../../packages/session/session-format-v0-to-v1/tests/validation.spec.ts)钉住。原生 V3 准入不再应用种类集合，因此被保留的分支可通过目标还原。

拒绝是链上唯一拒绝“生产方 writer 与所有 reader 都接受的字节”的位置。持久化在拒绝后不发布后继，因此它的效果是让本可读取的 Session 永久无法打开。

## 决策

在本迁移边，message-source `kind` 或 content-block `type` 只要是非空字符串且不在 `SOURCE_KINDS` / `CONTENT_KINDS` 内，就是所有者不透明 JSON。

该分支按字节原样保留，不运行任何按种类的结构校验，其内部额外成员被接纳。非字符串或空字符串种类仍被拒绝。已知分支保留原有结构校验，包括 `agent-message` 的成员集合、relay 形式和非空 `senderSessionId`。每种种类诊断都点名源事件类型、其序号、带索引的载荷路径和收到的值，例如 `format v2 user/message at seq 2 data.source: message source kind must be a non-empty string; received 77`。源审计先于已发布载荷语义检查运行，因此畸形种类报告自己的诊断，而不是下游载荷失败。[源审计章节](../../../../packages/session/session-format-v2-to-v3/README.zh.md#source-audit)拥有被审计位置与诊断。

### 不透明保留不是未经证实的保留声明

[已发布格式迁移决策](2026-08-31-released-session-format-migrations.zh.md)主张「Preserving an unknown block without understanding its fields cannot establish that migration preserves its meaning」，并把历史内容准入归于入边。

该论证约束的是会改写所保留块的迁移边。本迁移边不改写：它只重命名精确的 PTC 与预设词汇、重映射已审计引用字段并规范化信封，从不改写消息内容或消息来源。因此被保留的分支正是生产方 writer 写出的 JSON，当前格式消息处理与原生 V3 准入都原样接受同一份 JSON。迁移不可能丢失它从未触碰的含义。

审计仍然建立它拥有的保证。已知分支保留结构校验，非字符串或空判别值仍然拒绝，因此每个被接纳的种类位置都带可用的标签。被删除的拒绝没有建立任何额外的保留事实；它只是让生产方与所有 reader 本就对字节达成一致的 Session 无法读取。

## 考虑过的替代方案

- **把报告者的种类加入审计集合**——单插件允许列表让可读性取决于迁移边听说过哪些插件，并会在下一个插件上失效；格式的映射按声明就是开放的，集合无法封闭。
- **迁移时丢弃未知分支**——让迁移保持可用，却删除 writer 产出且所有 reader 都接受的持久、模型可见内容。
- **在本迁移边把不透明性扩展到未知事件类型**——事件类型携带本迁移边要重映射的生命周期与引用含义，而已知载荷位置内的种类只是命名一个本迁移边不解释的分支；把二者混为一谈会削弱 [alpha 事件拒绝规则](2026-08-31-alpha-historical-unknown-event-refusal.zh.md)。
- **把接纳放宽到任意种类值，包括非字符串和空字符串**——没有可读判别值的位置无法被分类为消息来源或内容块，因此拒绝留在该边界并点名收到的值。
- **收紧原生 V3 准入或修改冻结的 V0 到 V1 校验器**——两者本就接受这些分支；改变独立承诺并不能修复拒绝它们的迁移边。

## 测试

[`opaque-kinds.spec.ts`](../../../../packages/session/session-format-v2-to-v3/tests/opaque-kinds.spec.ts)证明插件定义的来源种类和块类型在直接迁移、已发布 V3 codec 往返和已安装 catalog 迁移边中按字节原样保留；它还钉住畸形种类诊断，以及保留的 `agent-message` 与已知块拒绝。准入、内容准入、迁移、结构回归和 JSONL 内容准入测试套件携带更新后的带路径预期。

## 后果

仅因所有者定义种类而被拒绝的 Session 可以还原，迁移保持其源字节不变。

本迁移边不校验未知分支内部的私有字段。它依赖格式可合并扩展的判别契约，以及 reader 对未知分支作不透明处理；后续若某条迁移边要解释或改写分支内容，必须自行审计这些字段。

插件可以在不改变迁移的情况下新增或修改其分支内的私有成员，本迁移边接纳这些额外成员。

种类拒绝范围更窄：在种类位置，只有缺失、非字符串或空判别值会被拒绝，且诊断报告收到的值。
