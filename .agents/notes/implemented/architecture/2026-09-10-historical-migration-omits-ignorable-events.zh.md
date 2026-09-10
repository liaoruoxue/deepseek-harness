# Agent Note: 历史迁移省略显式可忽略的未知事件

Status: implemented

[English](2026-09-10-historical-migration-omits-ignorable-events.md) | 中文

## Problem

已发布的 Session 可能包含仓库外插件产生的信息型事件，其信封带有 `ignorable: true`。同版本读取会接纳该事件：v0 与 v1 编解码器都能解码该日志，已安装的当前词汇也把该标记视为允许省略该记录的声明。历史迁移则不然。除 v0-to-v1 恒等转换之外的每条迁移边，只要事件类型不在其冻结的已发布清单中，就一律视为致命错误，即使 producer 已明确标记为可忽略。

一个这样的事件会让该 Session 永久无法加载。读取、恢复与模型选择都经过同一条加载路径，因此该拒绝也移除了该 Session 的模型选择能力。源产物在磁盘上没有后继，操作者除了编辑日志之外无法恢复访问。

该标记是"省略该事件是安全的"这一判断的唯一记录。拒绝它就丢弃了这条记录；原样复制 payload 则会保留一个不透明值，后续改变事件数量的迁移边无法校验其中的序号与生命周期事实。

## Decision

在重写事件位置的历史迁移边上，迁移会省略信封带有 `ignorable: true` 的未知事件并继续执行。v1-to-v2 与 v2-to-v3 边适用该规则。v0-to-v1 边保持事件位置不变，因此原样接纳同一事件，而不是省略它。

没有该标记的未知事件仍会使迁移失败，诊断会点名事件类型、序号与保持不变的源 generation。如果某个保留事件声明的引用指向被省略事件的序号，该迁移边也会拒绝；省略绝不会把引用重定向到另一个事件。

迁移保留精确的源 generation：它发布当前格式的后继，并保持源路径、字节与 inode 不变，因此被省略的记录在记录它的那一代际中仍可读取。[为外部插件保留可忽略 Session 事件](2026-08-30-retain-ignorable-external-session-events.zh.md)继续负责同版本 append 与 reload。

[Alpha Session 迁移拒绝所有未知历史事件](2026-08-31-alpha-historical-unknown-event-refusal.zh.md)记录了被取代的策略，它连带有标记的可忽略事件也会拒绝。该记录对未标记未知事件的拒绝、对意外 payload 成员的规则，以及 owner-opaque JSON 分类仍然有效。

## Alternatives considered

**逐字保留未知的可忽略事件。** 保留字节，但不能证明不透明数字或生命周期事实在结构迁移后仍有效；[alpha 记录](2026-08-31-alpha-historical-unknown-event-refusal.zh.md)正是据此拒绝逐字保留。保留还会产生一个携带目标代际从未分类过的 payload 的后继。

**继续拒绝所有未知历史事件。** 保证任何未分类 payload 都不会跨越迁移边；其代价是：即使 producer 已记录该事件可被省略，该 Session 也永远无法加载或恢复，包括模型选择。

**为外部 owner 提供迁移接口。** 已注册的按类型变换能让产出插件自行定义目标语义，是长期的持久方案。它需要注册机制、带版本的接口，以及 producer 缺席时的处理决定，因此无法恢复一个已经存在于已发布格式中的 Session。[为外部插件保留可忽略 Session 事件](2026-08-30-retain-ignorable-external-session-events.zh.md)出于同样理由拒绝了依赖组合的事件名注册。

## Consequences

迁移后的后继会丢失被省略的信息型记录。精确的源 generation 保留它，迁移也绝不重写或删除该 generation。没有 `ignorable: true` 的未知事件仍会被拒绝，因此未标记的持久事件不会静默消失。若某事件一旦被省略就会破坏某个保留引用，整次迁移都会被拒绝，而不是产出一个坐标悬空的后继。

该决定依据随记录存储的标记，而不是读取方挂载的插件。Catalog 仍在构建时静态确定，因此挂载或省略产出插件不会改变旧产物能否迁移。
