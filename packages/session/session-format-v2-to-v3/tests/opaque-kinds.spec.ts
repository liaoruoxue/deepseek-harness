/** Plugin-declared source kinds and content block types cross the V2-to-V3 edge as owner-opaque JSON. */

import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatEvent, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { releasedV3SessionFormatCodec, restoreReleasedV3Artifact, sessionFormatV2ToV3 } from '../src/index.ts'

const header = { version: 2, id: 'opaque-kinds', createdAt: 1, isSeeded: false, delegationDepth: 0 } as const
// The reporter's plugin-declared source kind with a private member the audit must not interpret.
const catalogSource = { kind: 'mcp-catalog', digest: 'sha256:catalog' }
const catalogBlock = { type: 'mcp-catalog-entry', digest: 'sha256:catalog', nested: { kind: 'mcp-catalog' } }
const notice = { id: 'catalog-notice', role: 'user', source: catalogSource, content: [catalogBlock] }
const event = (type: string, data: SessionFormatEvent['data'], extra: SessionFormatJsonObject = {}): SessionFormatEvent => ({ type, seq: 0, time: 1, data, ...extra })
const opening = [event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 })]
const closing = [event('step/end', { turn: 1, step: 1 }), event('turn/end', { turn: 1, reason: { kind: 'completed' } })]

function migrate(rows: readonly SessionFormatEvent[]): SessionFormatArtifact {
  const targetHeader = sessionFormatV2ToV3.migrateHeader(header)
  const stage = sessionFormatV2ToV3.createStage({ sourceHeader: header, targetHeader, sourceInheritedEventCount: 0, sourceKind: 'decoded' })
  const collector = new SessionFormatEventCollector()
  for (const [seq, row] of rows.entries()) stage.transformEvent({ ...row, seq }, collector)
  return { header: targetHeader, inheritedEventCount: stage.finish(collector), events: collector.values }
}

function roundTrip(artifact: SessionFormatArtifact): SessionFormatArtifact {
  const decoder = releasedV3SessionFormatCodec.createDecoder(releasedV3SessionFormatCodec.encodeHeader(artifact.header, artifact.inheritedEventCount), 'strict')
  const collector = new SessionFormatEventCollector()
  for (const row of artifact.events) decoder.decodeRow(releasedV3SessionFormatCodec.encodeEvent(row), collector)
  return restoreReleasedV3Artifact({ header: decoder.header, inheritedEventCount: decoder.finish(collector), events: collector.values }, new Set())
}

describe('V2 opaque message arms', () => {
  it('preserves a plugin-declared source kind and block type byte-for-byte through migration and the real codec', () => {
    const input = [...opening, event('user/message', notice, { surfaceOp: 'append' }), ...closing]
    const before = JSON.stringify(input)
    const artifact = migrate(input)
    const restored = restoreReleasedV3Artifact(artifact, new Set())
    expect(restored).toBe(artifact)
    expect(restored.events.find(row => row.type === 'user/message')?.data).toEqual(notice)
    expect(JSON.stringify(input)).toBe(before)
    const decoded = roundTrip(artifact)
    expect(decoded.events.find(row => row.type === 'user/message')?.data).toEqual(notice)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('preserves the opaque arm on an inbox insertion while remapping only the audited envelope references', () => {
    const inserted = { ...notice, id: 'inbox-notice' }
    const row = event('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [inserted] })
    const input = [...opening, event('user/message', { ...notice, id: 'human', source: { kind: 'user' } }, { surfaceOp: 'append' }), row]
    const before = JSON.stringify(input)
    const restored = restoreReleasedV3Artifact(migrate(input), new Set())
    expect(restored.events.find(entry => entry.type === 'agent/inbox/spliced')?.data).toEqual(row.data)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('preserves the opaque arm through the installed catalog edge', () => {
    const physical = { type: 'session', ...header }
    const rows = [
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      event('user/message', notice, { surfaceOp: 'append' }),
      ...closing,
    ]
    const before = JSON.stringify(rows)
    const reader = sessionFormatCatalog.createRestore(physical, { recovery: 'strict', validation: 'current' })
    for (const [seq, row] of rows.entries()) reader.decodeRow({ ...row, seq })
    const artifact = reader.finish()
    expect(artifact.header.version).toBe(3)
    expect(artifact.events.find(row => row.type === 'user/message')?.data).toEqual(notice)
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('refuses a malformed source kind and names the event, path, and received value', () => {
    const input = [...opening, event('user/message', { ...notice, source: { kind: 77 } }, { surfaceOp: 'append' })]
    expect(() => migrate(input)).toThrow(
      'format v2 user/message at seq 2 data.source: message source kind must be a non-empty string; received 77',
    )
    expect(() => migrate([...opening, event('user/message', { ...notice, source: { kind: '' } }, { surfaceOp: 'append' })]))
      .toThrow('data.source: message source kind must be a non-empty string; received ""')
  })

  it('refuses a malformed content kind and names the event, path, and received value', () => {
    const input = [...opening, event('user/message', { ...notice, content: [{ type: 77 }] }, { surfaceOp: 'append' })]
    expect(() => migrate(input)).toThrow(
      'format v2 user/message at seq 2 data.content[0]: message content kind must be a non-empty string; received 77',
    )
    expect(() => migrate([...opening, event('user/message', { ...notice, content: [{ type: '' }] }, { surfaceOp: 'append' })]))
      .toThrow('data.content[0]: message content kind must be a non-empty string; received ""')
  })

  it('still validates the known agent-message arm and every malformed known block arm', () => {
    const agent = { id: 'relay', role: 'user', source: { kind: 'agent-message', form: 'relay', senderSessionId: 'other' }, content: [catalogBlock] }
    expect(restoreReleasedV3Artifact(migrate([...opening, event('user/message', agent, { surfaceOp: 'append' }), ...closing]), new Set()))
      .toBeDefined()
    const badSource = { ...agent, source: { kind: 'agent-message', form: 'relay', senderSessionId: 'other', digest: 'extra' } }
    expect(() => migrate([...opening, event('user/message', badSource, { surfaceOp: 'append' })]))
      .toThrow('data.source kind "agent-message" has unexpected field digest')
    const badBlock = { ...notice, content: [{ type: 'text', text: 12 }] }
    expect(() => migrate([...opening, event('user/message', badBlock, { surfaceOp: 'append' })]))
      .toThrow('invalid message content kind "text"')
  })
})
