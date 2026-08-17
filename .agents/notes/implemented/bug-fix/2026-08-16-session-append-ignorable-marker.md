# Agent Note: Session.append accepts an ignorable marker for log-only events

Status: implemented

English | [中文](2026-08-16-session-append-ignorable-marker.zh.md)

## Problem

The trisol workbench plugin publishes GPU-overview state by appending a `workbench/gpu` event after every `trisol_resources_overview` run. The type is not a `SessionEventMap` member, so it is outside the generated `KNOWN_SESSION_EVENT_TYPES` vocabulary, and the unknown-event guard refuses to interpret a log that contains it unless the envelope carries `ignorable: true` (the [session-log version mechanism](../architecture/2026-08-10-session-log-version-mechanism.md) contract). `Session.append` could not set the marker — it accepted only surface metadata — so the first session that ran the tool became unloadable with `SessionFormatUnsupportedError`, and the plugin-development docs taught exactly the pattern that breaks.

A second, operator-side pitfall surfaced while repairing the artifact: a hand-recompressed log written as a single Zstandard frame failed `dsh web` startup, because the JSONL backend requires the first frame to contain exactly the header line ([zstandard JSONL session logs](../architecture/2026-07-19-zstandard-jsonl-session-logs.md)).

## Decision

**`Session.append` accepts `{ ignorable: true }` on log-only events.** The new `AppendFlags` option bag is legal only on non-surface events; surface events cannot carry it because they reconstruct the model-visible conversation, and dropping one would gut the session. The envelope stamps `ignorable: true`, and any other value for the field is rejected at append — the same "only true" contract the seed boundary enforces. This is the append-side surface the version-mechanism note deferred to its first user: `dsh-tool-trisol` now publishes `workbench/gpu` with the marker, and the plugin-development docs warn that a custom event type must be marked ignorable or declared in the vocabulary.

**Existing logs are repaired in place, not migrated.** The one affected session's `workbench/gpu` event (seq 303604) gained `"ignorable":true` by a single-line envelope edit; the artifact was re-framed into the header-frame plus event-frame layout and atomically replaced, byte-identical apart from the marker (the harness then appended its normal `session/end-seed` on load). Marking is semantically correct: the event is purely informational workbench state, consumed only by the plugin's own projection, and cleared at every `turn/start`.

## Verification

The source change typechecks; the session suite (79 tests) and both persistence suites (258 tests) pass, including new tests that a log-only append stamps the marker and round-trips it through seed/load, and that a non-true marker is rejected. The repaired artifact loads through the installed harness read path (323,856 events, 1,881 surface nodes), and the running harness stamps the marker on new appends after restart.

## Alternatives considered

- **Declaring `workbench/gpu` in `SessionEventMap`** — makes the type known only to builds that ship the declaration; the running harness and every older build still refuse the log, and required-on-read is the wrong semantic for purely informational state. The ignorable marker works across builds by construction.
- **Default-ignorable unknown events** — already rejected by the version mechanism: a forgotten marker would silently resume a gutted session instead of refusing loudly. Not revisited.
- **A per-plugin runtime registration surface for known types** — deferred by the version-mechanism note until a consumer exists; the marker is the interim and now has a first-party API.

## Consequences

- A custom informational event no longer makes a whole session log unreadable; the affected session loads again.
- The running harness needed a local hot-patch of the installed `@deepseek-ai/dsh-session` lib plus a rebuilt plugin bundle. A harness reinstall overwrites the hot-patch, so the source change is the durable fix.
- Hand-editing a `.jsonl.zstd` artifact must preserve the multi-frame layout — header-only first frame, then one frame per durable batch — or `dsh web` fails at startup (framing contract in the zstandard note).
- The version-mechanism note's "writers do not yet set `ignorable`" fact is updated in place: it now has its first producer.
