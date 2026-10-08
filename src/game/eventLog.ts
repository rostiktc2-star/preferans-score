import type { GameEvent, GameEventType, PlayerId, VisibleEvent } from './model'

export class EventLog {
  #events: GameEvent[] = []

  append(type: GameEventType, handNumber: number, publicData: Record<string, unknown> = {}, privateData?: Partial<Record<PlayerId, Record<string, unknown>>>): void {
    this.#events.push(Object.freeze({
      sequence: this.#events.length + 1,
      type,
      handNumber,
      publicData: structuredClone(publicData),
      privateData: privateData ? structuredClone(privateData) : undefined,
    }))
  }

  forPlayer(playerId: PlayerId): readonly VisibleEvent[] {
    return this.#events.map(event => Object.freeze({
      sequence: event.sequence,
      type: event.type,
      handNumber: event.handNumber,
      data: Object.freeze({ ...structuredClone(event.publicData), ...structuredClone(event.privateData?.[playerId] ?? {}) }),
    }))
  }
}
