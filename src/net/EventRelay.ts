import { Vector3 } from 'three';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { RelayedEvent } from './protocol';
import { round2 } from './protocol';

/** The host events clients replay as they are: enemies (sounds, effects, cash for kills) and the wave's progress. */
export const RELAYED_EVENTS: readonly RelayedEvent[] = [
  'enemySpawned',
  'enemyKilled',
  'enemyDamaged',
  'enemyFired',
  'enemyFootstep',
  'enemyCallout',
  'wavePlanned',
  'waveStarted',
  'squadSpawned',
  'enemiesRemaining',
  'waveCleared',
];

const VECTOR_KEY = '$v';

/** A payload ready to send: its Vector3 fields become tagged arrays (rounded to centimeters). Payloads are flat. */
export function encodePayload(payload: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = value instanceof Vector3 ? { [VECTOR_KEY]: [round2(value.x), round2(value.y), round2(value.z)] } : value;
  }
  return out;
}

/** The other way: tagged arrays back to Vector3. */
export function decodePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const tagged = value !== null && typeof value === 'object' && VECTOR_KEY in value ? (value as Record<string, number[]>)[VECTOR_KEY] : null;
    out[key] = tagged ? new Vector3(tagged[0], tagged[1], tagged[2]) : value;
  }
  return out;
}

/** Host: call `send` with each relayed event as it happens. Returns a function that stops it. */
export function relayHostEvents(events: EventBus<GameEvents>, send: (name: RelayedEvent, payload: Record<string, unknown>) => void): () => void {
  const stops = RELAYED_EVENTS.map((name) => events.on(name, (payload) => send(name, encodePayload(payload))));
  return () => stops.forEach((stop) => stop());
}

/** Client: replay one relayed host event on the local bus. */
export function replayEvent(events: EventBus<GameEvents>, name: RelayedEvent, payload: Record<string, unknown>): void {
  if (!RELAYED_EVENTS.includes(name)) return;
  // The payload came from the same event type on the host, so it has that event's shape.
  (events.emit as (type: RelayedEvent, payload: unknown) => void)(name, decodePayload(payload));
}
