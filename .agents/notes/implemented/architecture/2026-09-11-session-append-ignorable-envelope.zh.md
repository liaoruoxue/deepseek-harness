# Agent Note: 在非 surface 的 Session append 上暴露可忽略信封

Status: implemented

[English](2026-09-11-session-append-ignorable-envelope.md) | 中文

## 问题

持久化的 `SessionEvent` 信封带有 `ignorable?: true`；日志中出现 `KNOWN_SESSION_EVENT_TYPES` 之外的事件类型时，读取路径会拒绝解读该日志，除非该事件带有此标记。[Session log 版本决策](2026-08-10-session-log-version-mechanism.zh.md)是有意选择这个默认值的：忘写标记会把本可恢复的会话拒绝过头，而默认可忽略会静默恢复出残缺会话。

`Session.append` 没有提供设置该标记的途径。Surface 事件（`system/message`、`user/message`、`assistant/message`、`tool/result`）要求 `SurfaceIntent` 元数据，而它只承载 surface 位置与来源序列；其余事件类型完全不接受任何选项。因此仓库外插件没有为自身信息性记录写入的路径：只要出现第一条这样的记录，之后每次加载该会话都会以 "unknown to this harness and not marked ignorable" 拒绝，尽管读取器跳过它就能正确重建会话。多位仓库外插件作者报告了同一缺口，包括本讨论中的 dsh-click 案例（#3191）。

## 决策

`Session.append(type, data, opts?)` 在非 surface 事件类型上接受可选的仅日志 `AppendOpts` 信封，传入 `{ ignorable: true }` 时该标记会落到持久化事件的信封上。`AppendOpts` 声明于 [types.ts](../../../../packages/core/session/src/types.ts)，目前只含 `ignorable?: true`。Surface 类型仍要求强制的 `SurfaceIntent`；[index.ts](../../../../packages/core/session/src/index.ts) 中 `Session.append` 的条件剩余参数让编译器在每个调用点强制这一划分。

append 路径通过各字段自身的存在性守卫读取选项——`'surfaceOp' in opts`、`'sourceEventSeqs' in opts`、`'ignorable' in opts`——而不是对整个选项对象断言成某一种类型。放宽类型后只传 `sourceEventSeqs` 的调用方仍会带着该字段进入 surface 校验，而调用方未提供的 surface 元数据保持缺失，不会被断言成某个值。

追加 `KNOWN_SESSION_EVENT_TYPES` 之外且未带标记的类型时，写入侧用 `console.warn` 告警，并给出会话与事件类型。追加本身仍然成功：payload 与 JSON 快照校验、surface 校验，以及 surface 事件强制的 `SurfaceIntent` 均未改变；对已知类型既不要求该标记，也不读取它。

### 读写不对称

拒绝仍留在读取侧。`validateStoredEvents`（[storage-contract.ts](../../../../packages/session/session-persistence/src/storage-contract.ts)）继续拒绝未知事件，除非其已存信封带有 `ignorable: true`；由于已存记录无法区分二者，其消息在"更新的 harness 写入"之外同时点出仓库外插件这一情形。写入侧只告警而不拒绝，因为 append 时的词汇拒绝会中断活跃会话的持久化，而写入方正是唯一能通过标记记录来修正它的一方。

## 曾考虑的替代方案

**把仓库外事件名称或类型注册为已知。**[外部插件保留决策](2026-08-30-retain-ignorable-external-session-events.zh.md)已否决把注册作为兼容机制：注册一个名称并不能判定省略该事件是否安全，接受与否会取决于读取 build 挂载的组合，而不是已存记录。持久化标记把该分类保留在每条事件上，插件无需注册即可设置它。

**把所有未知类型默认视为可忽略。**[Session log 版本决策](2026-08-10-session-log-version-mechanism.zh.md)否决了这个默认值：它把忘写标记从可见的过度拒绝变成静默恢复出缺少必需事件的会话。安全的分类保留在每条记录上，因为只有它的生产方知道省略是否安全。

**在 append 时拒绝未知类型而不是告警。**在写入侧拒绝会让活跃会话的持久化取决于写入 build 的已知类型清单，于是每个后续读取方都能跳过的一条插件事件反而会阻塞产生它的写入方。读取侧守卫已经在遗漏未被证明安全的所有位置拒绝日志；append 则记录该事件并报告风险。

## 后果

换来的是：仓库外插件可以通过公开 API 标记自己的信息性事件，包含这些事件的会话能在不认识该类型的 build 上恢复。写入侧会带上会话 id 与事件类型报告这条会破坏会话的记录，而不是任其静默累积到下一次冷加载。

代价是：该告警是诊断而不是守卫。未带标记的未知类型仍会在读取时被拒绝，对忽略告警的写入方而言仍会产出同样无法加载的会话；`Session.append` 现在会在运行时查询生成的 `KNOWN_SESSION_EVENT_TYPES` 集合，因此写入路径与读取路径依赖同一份生成目录。该标记对已知类型也是惰性的：它会被存储，但没有任何读取规则在那里读取它。

`AppendOpts` 是唯一的非 surface append 选项。它不承载 surface 元数据，surface 事件也不接受它；放宽类型的选项对象会带着它提供的每个字段进入 surface 校验，因此选项对象与调用点声明分支的类型不一致会在此后暴露，而不会被静默丢弃。

## 测试

[Core Session 测试](../../../../packages/core/session/tests/session.spec.ts)固定了信封经 `structuredClone` 的往返、未传信封时标记缺失、未知类型未带标记时的告警，以及同一未知类型带上标记时的静默。

## 相关决策

[Session log 版本决策](2026-08-10-session-log-version-mechanism.zh.md)负责默认读取必需规则、格式版本策略，以及守卫留在读取侧的理由。[外部插件保留决策](2026-08-30-retain-ignorable-external-session-events.zh.md)负责该信封字段为何为仓库外消费方存在，以及删除它的条件。历史格式迁移是独立的一层：[alpha 历史事件决策](2026-08-31-alpha-historical-unknown-event-refusal.zh.md)对未知历史类型即使带可忽略标记也一律拒绝。
