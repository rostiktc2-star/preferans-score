import type { SavedGame } from './types'

export const STORAGE_KEY = 'preferans-score:game:v1'
export const serializeGame = (game: SavedGame): string => JSON.stringify(game)
export const deserializeGame = (raw: string): SavedGame => {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('Backup non valido')
  const game = value as Partial<SavedGame>
  if (game.schemaVersion !== 1 || !game.config || !Array.isArray(game.events) || !Array.isArray(game.undone)) throw new Error('Versione o struttura del backup non supportata')
  return game as SavedGame
}
export const saveGame = (game: SavedGame): void => localStorage.setItem(STORAGE_KEY, serializeGame(game))
export const loadGame = (): SavedGame | null => { const raw = localStorage.getItem(STORAGE_KEY); return raw ? deserializeGame(raw) : null }
