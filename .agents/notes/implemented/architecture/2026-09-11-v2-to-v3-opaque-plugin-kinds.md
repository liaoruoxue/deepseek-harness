# Agent Note: Plugin-declared kinds cross the V2-to-V3 edge as owner-opaque JSON

Status: implemented

English | [中文](2026-09-11-v2-to-v3-opaque-plugin-kinds.zh.md)

## Problem

The [source audit](../../../../packages/session/session-format-v2-to-v3/README.md#source-audit) of the V2-to-V3 migration refused every message-source `kind` and content-block `type` outside its audited sets. A repository-external plugin appends an informational `user/message` whose `source.kind` is `mcp-catalog`; after upgrading, 552 of the reporter's 574 local v0 Sessions could not be opened, each refused with `cannot safely transform unclassified message source` (discussion #3191). The same content loads unchanged in a V3 Session written and read by the same installed harness.

Every other point in the chain accepts those arms. [Message sources](../../../../packages/llm/llm/src/message.ts) and [content blocks](../../../../packages/llm/llm/src/types.ts) are declaration-merged maps whose types are documented to switch on the tag and fall through unknowns, and [session append validation](../../../../packages/core/session/src/index.ts) requires only a non-empty string kind. The [V0-to-V1 edge](../../../../packages/session/session-format-v0-to-v1/src/payload-validation.ts) preserves an unknown non-empty source kind and content-block type as owner-opaque JSON, pinned by [its validation suite](../../../../packages/session/session-format-v0-to-v1/tests/validation.spec.ts). Native V3 admission does not re-apply the kind sets, so a preserved arm survives target restoration.

The refusal was the only point in the chain rejecting bytes that both the producing format's writer and every reader accept. Persistence publishes no successor after a refusal, so its effect was to make otherwise readable Sessions permanently unopenable.

## Decision

At this edge, a message-source `kind` or content-block `type` that is a non-empty string outside `SOURCE_KINDS` / `CONTENT_KINDS` is owner-opaque JSON.

The arm is preserved byte-for-byte, no per-kind structural validation runs, and extra members inside it are admitted. A non-string or empty-string kind still refuses. Known arms keep the structural validation they had, including the `agent-message` member set, relay form, and non-empty `senderSessionId`. Every kind diagnostic names the source event type, its sequence, the indexed payload path, and the received value, as in `format v2 user/message at seq 2 data.source: message source kind must be a non-empty string; received 77`. The source audit runs before the released payload-semantics check so a malformed kind reports its own diagnostic instead of a downstream payload failure. The [source audit section](../../../../packages/session/session-format-v2-to-v3/README.md#source-audit) owns the audited positions and the diagnostics.

### Opaqueness is not an unverified preservation claim

The [released-format migration decision](2026-08-31-released-session-format-migrations.md) argues that "Preserving an unknown block without understanding its fields cannot establish that migration preserves its meaning", and places historical content admission at the incoming edge.

That argument governs an edge that rewrites the block it preserves. This edge does not: it renames the exact PTC and preset vocabulary, remaps the audited reference fields, and canonicalizes envelopes, and it never rewrites message content or a message source. The preserved arm is therefore exactly the JSON the producing writer emitted, and current-format message handling and native V3 admission accept that same JSON unchanged. Migration cannot lose a meaning it never touches.

The audit still establishes what it owns. Known arms keep their structural validation, and a non-string or empty discriminant still refuses, so every admitted kind position carries a usable tag. The removed refusal established no additional preservation fact; it only made Sessions unreadable whose producer and every reader already agree on the bytes.

## Alternatives considered

- **Add the reporter's kind to the audited set** — a one-plugin allowlist makes readability depend on which plugin names the edge has heard of and breaks the next plugin; the format's maps are open by declaration, so the set cannot be closed.
- **Drop the unknown arm during migration** — keeps migration available but deletes durable, model-visible content that the writer produced and every reader accepts.
- **Extend opaqueness to unknown event types at this edge** — an event type carries lifecycle and reference meaning that this edge remaps, while a kind inside a known payload position names an arm the edge does not interpret; conflating the two would weaken the [alpha event-refusal rule](2026-08-31-alpha-historical-unknown-event-refusal.md).
- **Widen acceptance to every kind value, including non-strings and empty strings** — a position without a readable discriminant cannot be classified as a message source or content block, so refusal stays at that boundary and names the received value.
- **Narrow native V3 acceptance or edit the frozen V0-to-V1 validator** — both already accept these arms; changing independent promises would not fix the edge that refused.

## Testing

[`opaque-kinds.spec.ts`](../../../../packages/session/session-format-v2-to-v3/tests/opaque-kinds.spec.ts) proves byte-for-byte preservation of a plugin-declared source kind and block type through direct migration, the released V3 codec round-trip, and the installed catalog edge; it also pins the malformed-kind diagnostics and the retained `agent-message` and known-block refusals. The admission, content-admission, migration, structural-regression, and JSONL content-admission suites carry the updated path-qualified expectations.

## Consequences

Sessions whose only refusal was an owner-defined kind restore, and migration leaves their source bytes unchanged.

The edge does not validate the private fields inside an unknown arm. It relies on the format's merge-extensible discriminant contract and on readers treating an unknown arm opaquely; a later edge that interprets or rewrites an arm's contents must audit those fields itself.

A plugin can add or change private members inside its arm without a migration change, and this edge admits those extra members.

Kind refusal is narrower: only a missing, non-string, or empty discriminant refuses at a kind position, and the diagnostic reports the received value.
