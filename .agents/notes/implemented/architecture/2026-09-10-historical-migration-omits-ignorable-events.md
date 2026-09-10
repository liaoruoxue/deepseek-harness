# Agent Note: Historical migration omits explicitly ignorable unknown events

Status: implemented

English | [中文](2026-09-10-historical-migration-omits-ignorable-events.zh.md)

## Problem

A released Session can contain an informational event from a repository-external plugin whose envelope carries `ignorable: true`. Equal-version reading accepts that event: the v0 and v1 codecs decode the log, and the installed current vocabulary treats the marker as permission to omit the record. Historical migration did not. Every edge outside the v0-to-v1 identity conversion treated a type missing from its frozen released inventory as fatal, including a type the producer had marked ignorable.

One such event made the Session permanently unloadable. Reading, resuming, and model selection all pass through the same load path, so the refusal also removed model selection for that Session. The source artifact remained on disk with no successor, and no operator action short of editing the log restored access.

The marker is the only recorded statement that omitting the event is safe. Refusing it discards that statement; copying the payload preserves an opaque value whose sequence numbers and lifecycle facts a later cardinality-changing edge cannot validate.

## Decision

A historical format edge that rewrites event positions omits an unknown event whose envelope carries `ignorable: true` and continues migration. The v1-to-v2 and v2-to-v3 edges apply this rule. The v0-to-v1 edge preserves event positions, so it admits the same event unchanged rather than omitting it.

An unknown event without the marker still refuses migration, and the diagnostic names the event type, its sequence number, and the unchanged source generation. An edge also refuses a retained event whose declared reference names the sequence number of an omitted event; omission never redirects a reference to a different event.

Migration keeps the exact source generation: it publishes a current successor and leaves the source path, bytes, and inode unchanged, so the omitted record remains readable in the generation that recorded it. [Retain ignorable session events for external plugins](2026-08-30-retain-ignorable-external-session-events.md) continues to own equal-version append and reload.

[Alpha Session migration refuses every unknown historical event](2026-08-31-alpha-historical-unknown-event-refusal.md) records the superseded policy, which refused a marked ignorable event as well. Its refusal of an unmarked unknown event, its unexpected-payload-member rule, and its owner-opaque JSON classification remain current.

## Alternatives considered

**Retain the unknown ignorable event verbatim.** Preserves the bytes but cannot prove that opaque numeric or lifecycle facts remain valid after a structural edge; the [alpha note](2026-08-31-alpha-historical-unknown-event-refusal.md) rejects verbatim retention for that reason. Retention also produces a successor carrying a payload the target generation never classified.

**Keep refusing every unknown historical event.** Guarantees that no unclassified payload crosses an edge, at the cost of a Session that never loads or resumes, including for model selection, even though its producer recorded that the event may be omitted.

**Give external owners a migration interface.** A registered per-type transformation would let the producing plugin define the target semantics itself and is the durable long-term option. It requires a registration mechanism, a versioned interface, and a decision for an absent producer, so it does not restore a Session that already exists in a released format. [Retain ignorable session events for external plugins](2026-08-30-retain-ignorable-external-session-events.md) rejects composition-dependent event-name registration for the same reason.

## Consequences

A migrated successor loses the omitted informational record. The exact source generation keeps it, and migration never rewrites or deletes that generation. An unknown event without `ignorable: true` still refuses, so an unmarked durable event cannot disappear silently. An event whose omission would break a retained reference refuses the whole migration instead of producing a successor with a dangling coordinate.

The decision follows the marker stored with the record, not the reader's mounted plugins. The catalog remains build-static, so mounting or omitting the producing plugin does not change whether an old artifact migrates.
