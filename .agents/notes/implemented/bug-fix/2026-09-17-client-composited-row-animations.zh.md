# Agent Note: 运行行的扫光改用 transform，微光改为阶跃

Status: implemented

[English](2026-09-17-client-composited-row-animations.md) | 中文

## Problem

对话视图里有一轮进行中时，会同时跑七个无限 CSS 动画。五个"运行行"扫光（reasoning、generic command、skill、tool、bash-sample 行）在一条绝对定位的 300px 光带上动画 `left`，于是每一帧都要重新布局该行。两个状态微光（`.turnStatus` 与重试文案）在 `background-clip: text` 下动画 `background-position`，于是每一帧都要重绘被裁剪的字形。这两个属性都位于逐帧关键路径上，而且都不是合成属性。即使没有任何一轮在跑，代价依然可见：讨论 #6427 在组装后的 0.1.5-rc.2 Web UI 上测得，暂停 `dsh-tool-row-sweep` 与 `dsh-turn-status-shimmer` 后，空闲主线程占用从 60.4% 降到 2.0%，LayoutCount 从每 10 秒 1443 次降到每 10 秒 10 次，而 `will-change` 没有任何改变。

## Decision

扫光保留光带、渐变、`2.6s ease-out infinite` 时长曲线、关键帧百分比与降级动效规则，只改三处声明。伪元素铺满整行（`width: 100%`），并把光晕作为不重复的背景图块承载（`background-size: 300px 100%; background-repeat: no-repeat`）；关键帧改为 0% 的 `transform: translateX(-300px)` 到 90% 与 100% 的 `translateX(100%)`。光带的包含块仍是原先那个定位并 `overflow: hidden` 的裁剪盒，因此 `width: 100%` 与旧的 `left: 100%` 依据同一宽度解析，一个光带宽度的行程依然等于一个行宽；渲染出的光带在几何上完全一致。每帧变化的只有 `transform`，且只在行处于运行状态时。

微光保留 `background-position`、渐变、`background-clip: text`、时长与关键帧，只把时间函数改为 `steps(10, end)`。阶跃的 `background-position` 把同一动画从每帧一次采样改为每周期十次，微光的动感不变而重绘次数降到约十分之一。不添加 `will-change`：仅用 transform 的动画只在行运行时提升一个合成层，行结束后自动释放，而不是给每个空闲行钉住一层。

## Alternatives considered

用 `will-change: transform` 或 `contain` 提升现有的 `left` 扫光，保留了布局依赖，而 #6427 已报告其无效。动画光带自身的 `background-position` 并随之移动一个更小的盒，等于把每帧一次布局换成每帧两次绘制。用 JavaScript 或对同一属性使用 Web Animation 驱动扫光，只是把代价换了个归属者。把微光改写成位移或遮罩叠加层可以让它彻底离开主线程，但它会用与 `background-clip: text` 不同的机制渲染状态文字，因此属于另一项改动而非本改动的一部分。把光带改造成 `mask-image` 渐变也因同样理由被否：它会改变光晕在主题内容上的合成方式，而本改动通过合成现有光带已经达到该结果。

## Measurement

在仓库外的页面（未使用仓库文件）上用原始 CDP 驱动 Chrome for Testing 131：一条 720px 的行，在两种实现下按周期 0%、0.15、0.3、0.5、0.7、0.9 采样光带的实时偏移，最大相差 0.0154px，在 0% 与 90–100% 完全相同；盒宽从 300px 变为 720px，而绘制的光带仍为 300px。

一条 60 行的页面在 5 秒内用 `Performance.getMetrics` 测得：改动前扫光为每秒 54 次布局、60 次样式重算、95ms 布局耗时、439.8ms 主线程任务；改动后为 0、0、0ms、2.8ms（空闲基线 0.3ms）。Blink trace 记录改动前每秒 paint/layout/styleRecalc 为 57/57/60，改动后为 0/0/0。对 120 个微光元素，每周期绘制从每秒 60 次降到 11 次（样式重算仍为每秒 60 次），每 5 秒的任务耗时从 678ms 降到 419ms。这些是复现页面的单页数字，不是 GUI 的数字。

在仓库内，这七个模块通过 Client 构建自身的 lightningcss 选项（`packages/client/tsdown.client.ts`）编译，并产出仅含 `transform` 的扫光关键帧，以及带 `background-size: 300px 100%`、`background-repeat: no-repeat` 和 `steps(10, end)` 微光的输出。读取这些文件的样式表契约用例（`chat-font-axis-styles`、`sticky-header-styles`、`tool-row-styles`、`turn-tail-spacing`、`approval-command`）23/23 通过。没有任何测试、fixture 或快照固化了旧声明。`pnpm run test:gui` 在完整 Client 与 Host 套件上通过（391 个文件、5579 个用例、0 失败），`DSH_SNAPSHOT=replay pnpm run test:web` 回放通道在打补丁与不打补丁时报告相同的 15 个失败文件与相同的单条快照判定。本 Note 的数字是诊断数据，不是 CI 预算；强制执行的浏览器测量仍由[大会话性能预算](../testing/2026-09-06-frontend-performance-budgets.zh.md)负责。

## Consequences

运行行不再逐帧进入布局或绘制。对 Client 各包里所有 `@keyframes` 的清点（38 条声明，其中 22 条为 `infinite`）没有再发现位于布局路径上的动画：其余都只动画 `transform` 或 `opacity`，而唯一仍在绘制路径上的一对，正是本 Note 改成阶跃的两个微光。微光仍有残余代价：阶跃的 `background-position` 依旧每秒重算样式 60 次，因此长时间运行的状态仍是剩余动画中最贵的一个，把它迁移到合成叠加层是后续待办。

光带宽度现在等于整宽盒上背景图块的尺寸。把 `width: 100%` 改回固定宽度，或把关键帧改回 `left`，都会恢复本 Note 所消除的逐帧布局。

lightningcss 会按 CSS 模块对动画名做哈希（`dsh-tool-row-sweep` 变成例如 `Kdx6DW_dsh-tool-row-sweep`），因此 #6427 里的 `document.getAnimations()` 二分排查必须匹配导出的名字而不是字面名。`prefers-reduced-motion` 块保持不变，包括 `ui-tool` 那两个没有该块的扫光，因为该包没有声明这种约定。

回放通道在参考 macOS 机器上剩余的 15 个失败都是环境性的，且在不打本改动时完全相同：沙箱在 `posix_openpt` 处拒绝的终端用例、`dev:web` 的 HMR 用例、被前置超时导致未消费完的 `llm-replay` fixture，以及在 Linux 上录制的 golden。我们没有对运行中的真实 GUI 做过测量——即让一行真正处于运行态、分别测补丁前后；上面的单页数字界定的是机制，而不是 GUI。
