# Agent Note: Running-row glares animate transform, and shimmers step

Status: implemented

English | [中文](2026-09-17-client-composited-row-animations.zh.md)

## Problem

Seven infinite CSS animations ran inside the conversation view while a turn is live. Five "running row" glares (reasoning, generic command, skill, tool, and bash-sample rows) animated `left` on a 300px absolutely positioned band, so every frame re-laid out the row. Two status shimmers (`.turnStatus` and the retry label) animated `background-position` under `background-clip: text`, so every frame repainted the clipped glyphs. Both properties sit on the per-frame critical path and neither is composited. The cost is visible with no turn running at all: discussion #6427 measured the assembled 0.1.5-rc.2 Web UI and reported that pausing `dsh-tool-row-sweep` and `dsh-turn-status-shimmer` moved idle main-thread occupancy from 60.4% to 2.0% and LayoutCount from 1443 per 10s to 10 per 10s, with `will-change` changing nothing.

## Decision

Sweeps keep their band, gradient, `2.6s ease-out infinite` timing, keyframe percentages, and reduced-motion rules, and change three declarations. The pseudo-element spans the row (`width: 100%`) and carries the glow as a non-repeating background tile (`background-size: 300px 100%; background-repeat: no-repeat`); the keyframes animate `transform: translateX(-300px)` at 0% to `translateX(100%)` at 90% and 100%. The band's containing block is the same positioned, `overflow: hidden` box that clipped it before, so `width: 100%` and the old `left: 100%` resolve against the same width and one band-width of travel still equals one row width; the rendered band is geometrically identical. Only `transform` changes per frame, and only while the row is running.

Shimmers keep `background-position`, the gradient, `background-clip: text`, the duration, and the keyframes, and change only the timing function to `steps(10, end)`. A stepped `background-position` samples the same animation at ten points per cycle instead of once per frame, so the shimmer keeps its motion while repainting about ten times less often. No `will-change` is added: the transform-only animation promotes a composited layer while a row is running and drops it when the row settles, instead of pinning one layer per idle row.

## Alternatives considered

Promoting the existing `left` sweep with `will-change: transform` or `contain` keeps the layout dependency and was reported ineffective in #6427. Animating the band's `background-position` and moving a smaller box with it trades a layout per frame for two paints per frame. Driving the sweep from JavaScript or a Web Animation on the same property preserves the cost in a new owner. Rewriting the shimmers as a translated or masked overlay would take them fully off the main thread, but it renders status text by a different mechanism than `background-clip: text`, so it is a separate change rather than part of this one. Reworking the band into a `mask-image` gradient was rejected for the same reason: it changes how the glare composites over themed content to reach a result this change already reaches by compositing the existing band.

## Measurement

Chrome for Testing 131 driven over raw CDP on an out-of-tree page (no repository files): a 720px row sampling the live band offset under both implementations agrees to 0.0154px maximum at 0%, 0.15, 0.3, 0.5, 0.7, and 0.9 of the cycle, and exactly at 0% and 90–100%; the box widens from 300px to 720px while the painted band stays 300px.

A 60-row page over 5s of `Performance.getMetrics` reports the sweep at 54 layouts/s, 60 style recalcs/s, 95ms layout, and 439.8ms main-thread task, against 0, 0, 0ms, and 2.8ms after the change (idle baseline 0.3ms). A Blink trace records paint/layout/styleRecalc of 57/57/60 per second before and 0/0/0 after. For 120 shimmer elements, paints drop from 60/s to 11/s per cycle (style recalc stays at 60/s) and task duration falls from 678ms to 419ms per 5s. These are per-page numbers from a reproduction, not the GUI.

In the repository, the seven modules compile through the Client build's own lightningcss options (`packages/client/tsdown.client.ts`) and emit `transform`-only sweep keyframes with `background-size: 300px 100%`, `background-repeat: no-repeat`, and `steps(10, end)` shimmers. The stylesheet-contract specs that read these files (`chat-font-axis-styles`, `sticky-header-styles`, `tool-row-styles`, `turn-tail-spacing`, `approval-command`) pass 23/23. No test, fixture, or snapshot encoded the old declarations. `pnpm run test:gui` passes over the full Client and Host suites (391 files, 5579 tests, 0 failures), and the `DSH_SNAPSHOT=replay pnpm run test:web` replay lane reports the same 15 failing files and the same single snapshot verdict with and without this change. This note's numbers are diagnostics, not CI budgets; the [large-session performance budgets](../testing/2026-09-06-frontend-performance-budgets.md) keep owning enforced browser measurements.

## Consequences

A running row no longer enters layout or paint per frame. An inventory of every `@keyframes` in the Client packages (38 declarations, 22 of them `infinite`) finds no other animation on the layout path: the rest animate `transform` or `opacity`, and the only remaining paint-bound pair is the two shimmers this note steps. The shimmer keeps a residual cost: a stepped `background-position` still recalculates style 60 times per second, so a long-running status remains the most expensive animation left, and moving it to a composited overlay is the deferred follow-up.

The glare band's width is now the background tile's size on a full-width box. Reverting `width: 100%` to a fixed width, or the keyframes to `left`, restores the per-frame layout this note removes.

lightningcss hashes animation names per CSS module (`dsh-tool-row-sweep` becomes e.g. `Kdx6DW_dsh-tool-row-sweep`), so the `document.getAnimations()` bisect from #6427 must match the exported name rather than the literal one. `prefers-reduced-motion` blocks are unchanged, including the two `ui-tool` sweeps that have none because that package declares no such convention.

The replay lane's remaining 15 failures on the reference macOS machine are environmental and identical without this change: terminal cases the sandbox refuses at `posix_openpt`, the `dev:web` HMR case, `llm-replay` fixtures a preceding timeout left partly consumed, and goldens recorded on Linux. A real-GUI measurement of the running product — a row actually running, before and after this patch — has not been made; the page numbers above bound the mechanism, not the GUI.
