/**
 * Who "the player" is on this machine. In single player it is always 'p0'. In multiplayer the host is 'p0'
 * and the others get 'p1'..'p3' as they join; kills, refunds and repairs are credited by these ids.
 */
let local = 'p0';

export function localPlayerId(): string {
  return local;
}

export function setLocalPlayerId(id: string): void {
  local = id;
}
