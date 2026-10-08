export type GameSound = 'deal' | 'play' | 'capture' | 'flip' | 'bid' | 'complete'

export class AudioManager {
  #context?: AudioContext
  muted = false
  volume = 0.12

  setMuted(muted: boolean): void { this.muted = muted }
  setVolume(volume: number): void { this.volume = Math.max(0, Math.min(1, volume)) }

  play(sound: GameSound): void {
    if (this.muted || typeof AudioContext === 'undefined') return
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return
    this.#context ??= new AudioContext()
    const now = this.#context.currentTime
    const oscillator = this.#context.createOscillator()
    const gain = this.#context.createGain()
    const settings: Record<GameSound, [number, number]> = {
      deal: [180, 0.035], play: [130, 0.05], capture: [95, 0.09], flip: [240, 0.045], bid: [420, 0.04], complete: [520, 0.14],
    }
    const [frequency, duration] = settings[sound]
    oscillator.type = sound === 'complete' ? 'sine' : 'triangle'
    oscillator.frequency.setValueAtTime(frequency, now)
    gain.gain.setValueAtTime(this.volume, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(gain).connect(this.#context.destination)
    oscillator.start(now)
    oscillator.stop(now + duration)
  }
}
