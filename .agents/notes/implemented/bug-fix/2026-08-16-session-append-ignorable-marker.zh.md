# Agent Note: Session.append 为 log-only 事件新增 ignorable 标记

Status: implemented

[English](2026-08-16-session-append-ignorable-marker.md) | 中文

## 问题

trisol workbench 插件在每次 `trisol_resources_overview` 执行后通过追加 `workbench/gpu` 事件发布 GPU 概览状态。该类型不是 `SessionEventMap` 成员，因此落在生成的 `KNOWN_SESSION_EVENT_TYPES` 词汇表之外，未知事件守卫会拒绝解读包含它的日志，除非信封带 `ignorable: true`（[会话日志版本机制](../architecture/2026-08-10-session-log-version-mechanism.md)的契约）。`Session.append` 当时无法设置该标记——它只接受 surface 元数据——所以第一个运行过该工具的会话就再也无法加载，报 `SessionFormatUnsupportedError`，而插件开发文档教的正是这个会踩坑的模式。

修复过程中还暴露了第二个运维侧坑：手工把日志重压成单个 Zstandard frame 会让 `dsh web` 启动失败，因为 JSONL 后端要求第一个 frame 恰好是一行 header（[Zstandard JSONL 会话日志](../architecture/2026-07-19-zstandard-jsonl-session-logs.md)）。

## 决定

**`Session.append` 在 log-only 事件上接受 `{ ignorable: true }`。** 新的 `AppendFlags` 选项袋只对非 surface 事件合法；surface 事件不能携带它，因为 surface 事件重建模型可见对话，丢掉一个就会掏空会话。信封写入 `ignorable: true`，字段出现其他值在 append 时直接拒绝——与 seed 边界执行的"只有 true"契约一致。这正是版本机制笔记推迟到"第一个使用者"出现时才落地的 append 侧表面：`dsh-tool-trisol` 现在带标记发布 `workbench/gpu`，插件开发文档也加了警告：自定义事件类型必须打 ignorable 标记，或声明进词汇表。

**已有日志就地修复，不迁移。** 受影响的唯一会话的 `workbench/gpu` 事件（seq 303604）通过单行信封编辑补上 `"ignorable":true`；产物按「header frame + 事件 frame」的布局重新分帧并原子替换，除标记外逐字节一致（harness 加载后又正常追加了自己的 `session/end-seed`）。打标在语义上正确：该事件是纯信息性的 workbench 状态，只被插件自己的投影消费，且每个 `turn/start` 都会清空。

## 验证

源码改动通过 typecheck；session 套件（79 个测试）与两个 persistence 套件（258 个测试）全绿，含新增测试：log-only append 打标并在 seed/load 往返中保留、非 true 标记被拒绝。修复后的产物经安装版 harness 读取路径加载成功（323,856 个事件、1,881 个 surface 节点）；服务器重启后，运行中的 harness 会对新 append 打上标记。

## 曾考虑的替代方案

- **把 `workbench/gpu` 声明进 `SessionEventMap`**：只会让包含该声明的构建认识它；当前运行中的 harness 和所有更老构建仍会拒绝日志，而且对纯信息状态来说"默认必需"的语义也不对。ignorable 标记按构造跨构建生效。
- **未知事件默认可忽略**：版本机制笔记已否决——忘写标记会从显式拒绝变成静默恢复残缺会话。不再讨论。
- **为已知类型提供插件运行时注册表面**：版本机制笔记推迟到真有消费者时再做；标记是过渡方案，如今已有第一方 API。

## 影响

- 自定义信息类事件不再让整个会话日志不可读；受影响的会话恢复可加载。
- 运行中的 harness 需要给已安装的 `@deepseek-ai/dsh-session` lib 打本地热补丁，并重建插件 bundle；harness 重装会覆盖热补丁，源码改动才是持久方案。
- 手工编辑 `.jsonl.zstd` 产物必须保持多 frame 布局——首帧只含 header，之后每批一帧——否则 `dsh web` 启动即失败（framing 契约见 zstandard 笔记）。
- 版本机制笔记中"写入侧目前不写 ignorable"的事实已就地更新：现在有了第一个生产者。
