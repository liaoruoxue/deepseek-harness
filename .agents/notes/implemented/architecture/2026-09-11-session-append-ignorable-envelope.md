# Agent Note: Expose the ignorable envelope on non-surface Session append

Status: implemented

English | [中文](2026-09-11-session-append-ignorable-envelope.zh.md)

## Problem

The persisted `SessionEvent` envelope carries `ignorable?: true`, and the read path refuses to interpret a log containing an event type outside `KNOWN_SESSION_EVENT_TYPES` unless that event carries the marker. The [session log versioning decision](2026-08-10-session-log-version-mechanism.md) chose that default deliberately: a forgotten marker over-refuses a resumable session, while a default of ignorable would silently resume a gutted one.

`Session.append` offered no way to set the marker. Surface events (`system/message`, `user/message`, `assistant/message`, `tool/result`) require `SurfaceIntent` metadata, which carries surface placement and source sequences only; every other event type accepted no options at all. An out-of-repo plugin therefore had no write path for its own informational records: the first such record makes every later load of that session refuse with "unknown to this harness and not marked ignorable", although a reader that skips it reconstructs the session correctly. Several out-of-tree plugin authors reported the same gap, including the dsh-click case in this discussion (#3191).

## Decision

`Session.append(type, data, opts?)` accepts an optional log-only `AppendOpts` envelope on non-surface event types, and `{ ignorable: true }` lands on the persisted event's envelope. `AppendOpts` is declared in [types.ts](../../../../packages/core/session/src/types.ts) and holds `ignorable?: true`. Surface types keep their mandatory `SurfaceIntent`; the conditional rest parameter on `Session.append` in [index.ts](../../../../packages/core/session/src/index.ts) makes the compiler enforce that split at every call site.

The append path reads each option field through its own presence guard — `'surfaceOp' in opts`, `'sourceEventSeqs' in opts`, `'ignorable' in opts` — instead of asserting one option type for the whole bag. A widened caller that supplies either surface field alone still reaches surface validation with that field intact, and surface metadata a caller did not supply stays absent rather than becoming an asserted value.

Appending a type outside `KNOWN_SESSION_EVENT_TYPES` without the marker warns at the write site with `console.warn`, naming the session and the event type. The append still succeeds: payload and JSON-snapshot validation, surface validation, and the mandatory `SurfaceIntent` for surface events are unchanged, and the marker is neither required nor consulted for known types.

### Read and write asymmetry

The refusal stays on the read side. `validateStoredEvents` ([storage-contract.ts](../../../../packages/session/session-persistence/src/storage-contract.ts)) continues to reject an unknown event unless its stored envelope carries `ignorable: true`, and its message names the out-of-tree plugin case next to the newer-harness case because the stored record cannot distinguish them. The write side warns instead of refusing, because append-time vocabulary refusal would stall a live session's durability, and the writer is the one party that can fix the record by marking it.

## Alternatives considered

**Register out-of-repo event names or types as known.** The [external-plugin retention decision](2026-08-30-retain-ignorable-external-session-events.md) rejected registration as the compatibility mechanism: a registered name does not classify whether omitting the event is safe, and acceptance would depend on the reading build's mounted composition instead of the stored record. The persisted marker keeps that classification with each event, and a plugin sets it without registering anything.

**Treat every unknown type as ignorable by default.** The [session log versioning decision](2026-08-10-session-log-version-mechanism.md) rejected this default: it turns a forgotten marker from a visible over-refusal into a silently resumed session that is missing a required event. The safe classification stays with each record because only its producer knows whether omission is safe.

**Refuse unknown types at append time instead of warning.** Refusal at the write site makes a live session's durability depend on the writing build's known-type list, so a plugin event that every later reader could skip blocks the writer that produced it. The read-side guard already refuses the log wherever omission is unproven; appending records the event and reports the risk.

## Consequences

Bought: an out-of-repo plugin marks its informational events through the public API, and a session containing them resumes on a build that does not know the type. The write site reports a session-breaking record with its session id and type instead of letting it accumulate silently until the next cold load.

Cost: the warning is a diagnostic, not a guard. An unknown type without the marker still refuses on read and still produces the same unloadable session for a writer that ignores the warning, and `Session.append` now consults the generated `KNOWN_SESSION_EVENT_TYPES` set at runtime, so the write path depends on the same generated catalog as the read path. The marker is also inert on known types: it is stored, and no read rule consults it there.

`AppendOpts` is the only non-surface append option. It carries no surface metadata, and surface events do not accept it; a widened option bag reaches surface validation with every field it supplied, so a bag that disagrees with the call's declared branch surfaces downstream instead of being silently reduced.

## Testing

[Core Session tests](../../../../packages/core/session/tests/session.spec.ts) pin the envelope round trip through `structuredClone`, the absent marker when no envelope is passed, the warning for an unknown type without the marker, and the silence when that unknown type is marked.

## Related decisions

The [session log versioning decision](2026-08-10-session-log-version-mechanism.md) owns the default-required read rule, the format-version policy, and the reason the guard stays read-side. The [external-plugin retention decision](2026-08-30-retain-ignorable-external-session-events.md) owns why the envelope field exists for out-of-repo consumers and the condition for removing it. Historical format migration is a separate layer: the [alpha historical-event decision](2026-08-31-alpha-historical-unknown-event-refusal.md) refuses unknown historical types even when they are marked ignorable.
