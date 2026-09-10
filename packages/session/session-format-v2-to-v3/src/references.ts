/** Explicit local-coordinate remapping; captured generations and owner-local counters remain opaque. */

import { SessionFormatError, SessionFormatUnsupportedMigrationError, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonObject, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { record } from './payload.ts'

/**
 * Source position whose explicitly ignorable event the target generation omits.
 * A target coordinate is always a number, so a lookup that finds this marker can never mistake it for a position.
 */
export interface OmittedSourceEvent {
  readonly omittedType: string
}

/**
 * Remap only audited same-artifact references, preserving IDs and embedded model input.
 * @param event - validated source event.
 * @param seq - output event position.
 * @param mapping - earlier source positions mapped to output positions or to omission markers.
 * @returns the event in target coordinates.
 */
export function remapEvent(event: SessionFormatEvent, seq: number, mapping: readonly (number | OmittedSourceEvent)[]): SessionFormatEvent {
  const one = (value: SessionFormatJsonValue | undefined, label: string): number => {
    const source = sessionFormatCount(value, label)
    const target = mapping[source]
    if (source >= event.seq || target === undefined) throw new SessionFormatError(`${label} must name an earlier source event`)
    if (typeof target !== 'number') {
      throw new SessionFormatUnsupportedMigrationError(`${label} targets ignorable event ${JSON.stringify(target.omittedType)} omitted at seq ${source}`)
    }
    return target
  }
  const list = (value: SessionFormatJsonValue | undefined, label: string): number[] => {
    if (!Array.isArray(value)) throw new SessionFormatError('sequence references must be an array')
    return (value as readonly SessionFormatJsonValue[]).map(item => one(item, label))
  }
  const range = (value: SessionFormatJsonValue | undefined, label: string): SessionFormatJsonObject => {
    const source = record(value, 'sequence range')
    return { ...source, start: one(source['start'], label + ' start'), end: one(source['end'], label + ' end') }
  }
  let data = record(event.data, event.type)
  switch (event.type) {
    case 'command/done':
      if (data['sourceEventSeq'] !== undefined) data = { ...data, sourceEventSeq: one(data['sourceEventSeq'], `${event.type} ${event.seq} sourceEventSeq`) }
      break
    case 'compaction/summary':
    case 'compaction/prune':
      data = { ...data, shadowedRange: range(data['shadowedRange'], `${event.type} ${event.seq} shadowedRange`), shadowedSeqs: list(data['shadowedSeqs'], `${event.type} ${event.seq} shadowedSeqs`) }
      break
    case 'session/title':
    case 'session/title-llm-request':
      data = { ...data, messageSeqs: list(data['messageSeqs'], `${event.type} ${event.seq} messageSeqs`) }
      break
    // Delivery watermarks and session-reference captures identify their original generation.
    // Workflow seq, stream block indices, turn/step, and numeric tool JSON are not Session seqs.
  }
  return {
    ...event, seq, data,
    ...(event['sourceEventSeqs'] === undefined ? {} : { sourceEventSeqs: list(event['sourceEventSeqs'], `${event.type} ${event.seq} sources`) }),
    ...(event['surfaceOp'] === undefined || event['surfaceOp'] === 'append'
      ? {} : { surfaceOp: range(event['surfaceOp'], `${event.type} ${event.seq} surface`) }),
  }
}
