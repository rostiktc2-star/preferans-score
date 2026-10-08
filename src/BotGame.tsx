import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioManager, ContractKind, DefenderDecision, DefenseMode, GameEngine, GamePhase, GamePresentationController, Rank, Suit, animationDuration, type AuctionAction, type Bid, type Card, type GameSpeed, type PlayerId, type PlayerView, type PresentationAnimation, type Trump } from './game'
import { AdvancedAiMode, AdvancedBotAdvisor, PlayStyle, PreferansBot, SkillLevel } from './ai'

const HUMAN = 'you', BOT_LEFT = 'alex', BOT_RIGHT = 'mikhail'
const PLAYERS = [{ id: HUMAN, name: 'Tu' }, { id: BOT_LEFT, name: 'Alex' }, { id: BOT_RIGHT, name: 'Mikhail' }] as const
const SUIT_SYMBOL: Record<Suit, string> = { [Suit.SPADES]: '♠', [Suit.CLUBS]: '♣', [Suit.DIAMONDS]: '♦', [Suit.HEARTS]: '♥' }
const SUIT_NAME: Record<Suit, string> = { [Suit.SPADES]: 'picche', [Suit.CLUBS]: 'fiori', [Suit.DIAMONDS]: 'quadri', [Suit.HEARTS]: 'cuori' }
const RANK_LABEL: Record<Rank, string> = { [Rank.SEVEN]: '7', [Rank.EIGHT]: '8', [Rank.NINE]: '9', [Rank.TEN]: '10', [Rank.JACK]: 'J', [Rank.QUEEN]: 'Q', [Rank.KING]: 'K', [Rank.ACE]: 'A' }
const nameOf = (id?: string) => PLAYERS.find(player => player.id === id)?.name ?? '—'
const suitLabel = (trump: Trump) => trump === 'NT' ? 'NT' : SUIT_SYMBOL[trump]
const bidLabel = (bid: Bid) => bid.kind === ContractKind.MIZER ? 'Mizer' : `${bid.level}${suitLabel(bid.trump)}`
const newEngine = (poolTarget: number) => { const game = new GameEngine({ players: PLAYERS, poolTarget }); game.startGame(); return game }
const newBots = () => ({
  [BOT_LEFT]: new PreferansBot(BOT_LEFT, { skillLevel: SkillLevel.NORMAL, playStyle: PlayStyle.CONSERVATIVE, seed: `alex-${Date.now()}`, monteCarloSamples: 20, timeBudgetMs: 45 }),
  [BOT_RIGHT]: new PreferansBot(BOT_RIGHT, { skillLevel: SkillLevel.HARD, playStyle: PlayStyle.AGGRESSIVE, seed: `mikhail-${Date.now()}`, monteCarloSamples: 70, timeBudgetMs: 120 }),
})

interface PlayingCardProps { card?: Card; face?: 'front' | 'back'; selected?: boolean; playable?: boolean; disabled?: boolean; publicCard?: boolean; compact?: boolean; animation?: 'dealing' | 'playing' | 'captured'; onClick?: () => void; onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void }
function PlayingCard({ card, face = 'front', selected, playable, disabled, publicCard, compact, animation, onClick, onDragStart }: PlayingCardProps) {
  const red = card?.suit === Suit.DIAMONDS || card?.suit === Suit.HEARTS
  const label = face === 'back' || !card ? 'Carta coperta' : `${RANK_LABEL[card.rank]} di ${SUIT_NAME[card.suit]}`
  return <button type="button" className={`g-card ${face === 'back' ? 'is-back' : 'is-front'} ${red ? 'is-red' : ''} ${selected ? 'is-selected' : ''} ${playable ? 'is-playable' : ''} ${disabled ? 'is-disabled' : ''} ${publicCard ? 'is-public' : ''} ${compact ? 'is-compact' : ''} ${animation ? `is-${animation}` : ''}`} aria-label={label} aria-pressed={selected} aria-disabled={disabled} draggable={Boolean(playable && !disabled)} onDragStart={onDragStart} onClick={onClick}>
    {face === 'front' && card ? <><span className="g-card-corner"><b>{RANK_LABEL[card.rank]}</b><i>{SUIT_SYMBOL[card.suit]}</i></span><span className="g-card-pip" aria-hidden>{SUIT_SYMBOL[card.suit]}</span><span className="g-card-corner is-bottom" aria-hidden><b>{RANK_LABEL[card.rank]}</b><i>{SUIT_SYMBOL[card.suit]}</i></span></> : <span className="g-card-back-pattern" aria-hidden>♢</span>}
  </button>
}

function Opponent({ id, side, view, animation }: { id: PlayerId; side: 'left' | 'right'; view: PlayerView; animation?: PresentationAnimation }) {
  const cards = view.publicHands[id], count = view.handSizes[id] ?? 0, decision = view.defenderDecisions[id]
  const bubbleEvent = animation?.kind === 'BID_BUBBLE' && animation.event.data.playerId === id ? animation.event : undefined
  const bubble = bubbleEvent ? bubbleEvent.type === 'PLAYER_PASSED' || bubbleEvent.type === 'DEFENDER_PASS' ? 'Pass' : bubbleEvent.type === 'DEFENDER_VIST' ? 'Vist' : bubbleEvent.type === 'POLVIST_DECLARED' ? 'Polvist' : bidLabel(bubbleEvent.data.bid as Bid) : undefined
  return <article className={`g-opponent is-${side} ${view.currentPlayerId === id ? 'is-turn' : ''} ${view.contract?.declarerId === id ? 'is-declarer' : ''}`} data-testid={`opponent-${id}`}>
    {bubble && <div className="g-speech" role="status">{bubble}</div>}
    <div className="g-player-badge"><span className="g-avatar">{nameOf(id).slice(0, 1)}</span><div><strong>{nameOf(id)}</strong><small>{view.tricksWon[id] ?? 0} prese · {count} carte</small></div></div>
    <div className={`g-opponent-hand ${cards ? 'is-open' : ''}`} aria-label={`Mano di ${nameOf(id)}: ${cards ? 'pubblica' : 'coperta'}`}>{(cards ?? Array.from({ length: count }, () => undefined)).map((card, index) => <PlayingCard key={card?.id ?? `${id}-back-${index}`} card={card} face={card ? 'front' : 'back'} publicCard={Boolean(card)} compact />)}</div>
    <div className="g-role-row">{view.contract?.declarerId === id && <span>Dichiarante</span>}{decision && <span>{decision}</span>}</div>
  </article>
}

function AuctionPanel({ view, onAction }: { view: PlayerView; onAction: (action: AuctionAction) => void }) {
  const legal = view.legalAuctionActions
  const bids = legal.filter((action): action is Bid => action !== 'PASS')
  const firstBid = bids[0]
  const [level, setLevel] = useState<6 | 7 | 8 | 9 | 10 | 'MIZER'>(() => firstBid?.kind === ContractKind.MIZER ? 'MIZER' : firstBid?.level ?? 6)
  const [trump, setTrump] = useState<Trump>(() => firstBid?.kind === ContractKind.NORMAL ? firstBid.trump : Suit.SPADES)
  const legalKey = bids.map(bidLabel).join('|')
  useEffect(() => {
    if (!firstBid) return
    const stillLegal = bids.some(bid => level === 'MIZER' ? bid.kind === ContractKind.MIZER : bid.kind === ContractKind.NORMAL && bid.level === level && bid.trump === trump)
    if (!stillLegal) {
      setLevel(firstBid.kind === ContractKind.MIZER ? 'MIZER' : firstBid.level)
      if (firstBid.kind === ContractKind.NORMAL) setTrump(firstBid.trump)
    }
  // legalKey represents the complete set of choices for this turn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legalKey])
  if (view.phase !== GamePhase.BIDDING || view.currentPlayerId !== HUMAN || legal.length === 0) return null
  const levels = [6, 7, 8, 'MIZER', 9, 10] as const
  const trumps = [Suit.SPADES, Suit.CLUBS, Suit.DIAMONDS, Suit.HEARTS, 'NT'] as const
  const selectedBid = bids.find(bid => level === 'MIZER' ? bid.kind === ContractKind.MIZER : bid.kind === ContractKind.NORMAL && bid.level === level && bid.trump === trump)
  const chooseLevel = (nextLevel: typeof levels[number]) => {
    const available = bids.find(bid => nextLevel === 'MIZER' ? bid.kind === ContractKind.MIZER : bid.kind === ContractKind.NORMAL && bid.level === nextLevel)
    if (!available) return
    setLevel(nextLevel)
    if (available.kind === ContractKind.NORMAL) setTrump(available.trump)
  }
  return <section className="g-decision-panel g-auction-panel" aria-label="La tua dichiarazione">
    <header><span>Asta</span><strong>Scegli il contratto</strong></header>
    <div className="g-auction-picker">
      <div className="g-wheel-group"><small>Livello</small><div className="g-wheel" role="radiogroup" aria-label="Livello del contratto">{levels.map(item => {
        const available = bids.some(bid => item === 'MIZER' ? bid.kind === ContractKind.MIZER : bid.kind === ContractKind.NORMAL && bid.level === item)
        return <button key={item} role="radio" aria-checked={level === item} className={level === item ? 'is-active' : ''} disabled={!available} onClick={() => chooseLevel(item)}>{item === 'MIZER' ? 'Mizer' : item}</button>
      })}</div></div>
      <div className={`g-wheel-group ${level === 'MIZER' ? 'is-muted' : ''}`}><small>{level === 'MIZER' ? 'Nessuna briscola' : 'Briscola'}</small><div className="g-wheel g-suit-wheel" role="radiogroup" aria-label="Seme di briscola">{trumps.map(item => {
        const available = level !== 'MIZER' && bids.some(bid => bid.kind === ContractKind.NORMAL && bid.level === level && bid.trump === item)
        return <button key={item} role="radio" aria-label={item === 'NT' ? 'Senza atout' : SUIT_NAME[item]} aria-checked={level !== 'MIZER' && trump === item} className={`${level !== 'MIZER' && trump === item ? 'is-active' : ''} ${item === Suit.DIAMONDS || item === Suit.HEARTS ? 'is-red' : ''}`} disabled={!available} onClick={() => setTrump(item)}>{item === 'NT' ? 'NT' : SUIT_SYMBOL[item]}</button>
      })}</div></div>
      <div className="g-auction-confirm"><small>Contratto scelto</small><strong>{selectedBid ? bidLabel(selectedBid) : '—'}</strong><button disabled={!selectedBid} onClick={() => selectedBid && onAction(selectedBid)}>Dichiara</button></div>
    </div>
    {legal.includes('PASS') && <button className="g-pass-button" onClick={() => onAction('PASS')}>Passo</button>}
  </section>
}
function DefenderPanel({ view, onDecision }: { view: PlayerView; onDecision: (decision: DefenderDecision) => void }) {
  if (view.phase !== GamePhase.DEFENDER_DECISIONS || view.currentPlayerId !== HUMAN) return null
  return <section className="g-decision-panel" aria-label="Decisione difensiva"><header><span>Difesa</span><strong>Come rispondi?</strong></header><div className="g-defender-actions">{view.legalDefenderDecisions.map(decision => <button key={decision} onClick={() => onDecision(decision)}>{decision === DefenderDecision.PASS ? 'Pass' : decision === DefenderDecision.VIST ? 'Vist' : 'Polvist'}</button>)}</div></section>
}

function PinnedScoreboard({ view, poolTarget }: { view: PlayerView; poolTarget: number }) {
  const recentTricks = view.completedTricks.slice(-3).reverse()
  return <aside className="g-scoreboard-pinned" aria-label="Punteggio e ultime prese sempre visibili">
    <header><span>Partita</span><strong>Punteggio</strong></header>
    <div className="g-score-players">{PLAYERS.map(player => <article key={player.id}>
      <strong>{player.name}</strong>
      <div className="g-score-main"><span>Pozzo <b>{view.scoreboard.scores[player.id]!.pool}/{poolTarget}</b></span><span>Multa <b>{view.scoreboard.scores[player.id]!.penalty}</b></span></div>
      <div className="g-score-credits"><small>Crediti</small>{PLAYERS.filter(other => other.id !== player.id).map(other => <span key={other.id}>vs {other.name} <b>{view.scoreboard.credits[player.id]![other.id]}</b></span>)}</div>
    </article>)}</div>
    <section className="g-recent-tricks"><h3>Ultime prese</h3>{recentTricks.length === 0 ? <p>Nessuna presa giocata</p> : recentTricks.map(trick => <div key={trick.number}><span>№ {trick.number}</span><strong>{nameOf(trick.winnerId)}</strong><small>{trick.cards.map(play => `${RANK_LABEL[play.card.rank]}${SUIT_SYMBOL[play.card.suit]}`).join(' · ')}</small></div>)}</section>
  </aside>
}
function resultSummary(view: PlayerView): { title: string; lines: string[] } {
  const scoreEvent = [...view.events].reverse().find(event => event.type === 'SCORE_UPDATED')
  const result = scoreEvent?.data.result as { kind?: string; poolAwards?: Record<string, number>; penalties?: Record<string, number>; credits?: Record<string, Record<string, number>> } | undefined
  if (!result) return { title: 'Mano conclusa', lines: [] }
  const title = result.kind === 'MIZER' ? 'Mizer concluso' : result.kind === 'RASPASY' ? `Raspasy ×${view.raspasyValue}` : view.contract ? `${view.contract.level}${suitLabel(view.contract.trump)}` : 'Mano conclusa'
  const lines = PLAYERS.map(player => { const pool = result.poolAwards?.[player.id] ?? 0, penalty = result.penalties?.[player.id] ?? 0, credit = Object.values(result.credits?.[player.id] ?? {}).reduce((sum, value) => sum + value, 0); return `${player.name}: ${view.tricksWon[player.id]} prese${pool ? ` · +${pool} Pozzo` : ''}${penalty ? ` · +${penalty} Multa` : ''}${credit ? ` · +${credit} Crediti` : ''}` })
  return { title, lines }
}

export default function BotGame({ onBack, poolTarget, onHandCompleted }: { onBack: () => void; poolTarget: number; onHandCompleted?: () => void }) {
  const engineRef = useRef<GameEngine | null>(null), presentationRef = useRef<GamePresentationController | null>(null), audioRef = useRef<AudioManager | null>(null), botsRef = useRef<Record<string, PreferansBot> | null>(null), advisorRef = useRef<AdvancedBotAdvisor | null>(null)
  if (!engineRef.current) engineRef.current = newEngine(poolTarget)
  if (!presentationRef.current) presentationRef.current = new GamePresentationController()
  if (!audioRef.current) audioRef.current = new AudioManager()
  if (!botsRef.current) botsRef.current = newBots()
  if (!advisorRef.current) advisorRef.current = new AdvancedBotAdvisor({ enabled: false, mode: AdvancedAiMode.BALANCED, maxCallsPerHand: 4, maxCallsPerGame: 40, budgetLimitUsd: .25, timeoutMs: 4000 })
  const [revision, setRevision] = useState(0), [animationRevision, setAnimationRevision] = useState(0)
  const [selected, setSelected] = useState<string[]>([]), [message, setMessage] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [speed, setSpeed] = useState<GameSpeed>('normal'), [muted, setMuted] = useState(false), [autoSort, setAutoSort] = useState(true), [manualOrder, setManualOrder] = useState<string[]>([])
  const [advancedAi, setAdvancedAi] = useState(false), [advancedMode, setAdvancedMode] = useState(AdvancedAiMode.BALANCED)
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const recordedHands = useRef(new Set<number>())
  const engine = engineRef.current, presentation = presentationRef.current
  const view = engine.getPlayerView(HUMAN)
  const animation = presentation.queue.current, busy = presentation.queue.isBusy
  const refresh = useCallback(() => { presentation.consume(engine.getPlayerView(HUMAN).events); setRevision(value => value + 1); setAnimationRevision(value => value + 1) }, [engine, presentation])
  if (revision === 0 && presentation.queue.snapshot().length === 0) presentation.consume(view.events)

  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReducedMotion(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  useEffect(() => { audioRef.current!.setMuted(muted) }, [muted])
  useEffect(() => { advisorRef.current!.configure({ enabled: advancedAi, mode: advancedMode }) }, [advancedAi, advancedMode])
  useEffect(() => { if (view.phase === GamePhase.HAND_COMPLETE && !recordedHands.current.has(view.handNumber)) { recordedHands.current.add(view.handNumber); onHandCompleted?.() } }, [onHandCompleted, view.handNumber, view.phase])
  const visibleHandKey = view.ownHand.map(card => card.id).join('|')
  useEffect(() => { const ids = visibleHandKey ? visibleHandKey.split('|') : []; setManualOrder(current => [...current.filter(id => ids.includes(id)), ...ids.filter(id => !current.includes(id))]) }, [visibleHandKey])
  useEffect(() => {
    const current = presentation.queue.current
    if (!current) return
    const sound = current.kind === 'DEAL_SEQUENCE' ? 'deal' : current.kind === 'CARD_TO_CENTER' ? 'play' : current.kind === 'CAPTURE_TRICK' ? 'capture' : current.kind === 'FLIP_TALON' ? 'flip' : current.kind === 'HAND_SUMMARY' ? 'complete' : 'bid'
    audioRef.current!.play(sound)
    const timer = window.setTimeout(() => { presentation.queue.completeCurrent(); setAnimationRevision(value => value + 1) }, animationDuration(current.kind, speed, reducedMotion))
    return () => clearTimeout(timer)
  }, [animation?.id, animationRevision, presentation, reducedMotion, speed])
  useEffect(() => {
    if (busy || [GamePhase.HAND_COMPLETE, GamePhase.GAME_COMPLETE].includes(view.phase)) return
    const humanTurn = view.currentPlayerId === HUMAN && [GamePhase.BIDDING, GamePhase.DEFENDER_DECISIONS, GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING, GamePhase.DECLARER_DISCARD].includes(view.phase)
    if (humanTurn) return
    const delayBase = speed === 'slow' ? 2800 : speed === 'fast' ? 950 : 1750
    const timer = window.setTimeout(async () => {
      try {
        const decide = async (playerId: string) => advancedAi ? (await advisorRef.current!.decide(botsRef.current![playerId]!, engine.getPlayerView(playerId))).decision : botsRef.current![playerId]!.decide(engine.getPlayerView(playerId))
        if (view.phase === GamePhase.BIDDING && view.currentPlayerId) { const decision = await decide(view.currentPlayerId); if (decision.type !== 'BID') throw new Error('Decisione asta inattesa'); engine.makeBid(view.currentPlayerId, decision.action) }
        else if (view.phase === GamePhase.DEFENDER_DECISIONS && view.currentPlayerId) { const decision = await decide(view.currentPlayerId); if (decision.type !== 'DEFENSE') throw new Error('Decisione difesa inattesa'); engine.makeDefenderDecision(view.currentPlayerId, decision.decision) }
        else if ([GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING].includes(view.phase) && view.currentPlayerId) { const decision = await decide(view.currentPlayerId); if (decision.type !== 'PLAY_CARD') throw new Error('Decisione carta inattesa'); engine.playCard(view.currentPlayerId, decision.card.id) }
        else if (view.phase === GamePhase.TRICK_COMPLETE) engine.resolveTrick()
        else if (view.phase === GamePhase.TALON_REVEAL) engine.revealTalon()
        else if (view.phase === GamePhase.DECLARER_DISCARD && view.currentPlayerId) { const decision = await decide(view.currentPlayerId); if (decision.type !== 'DISCARD') throw new Error('Decisione scarto inattesa'); engine.discard(view.currentPlayerId, decision.cardIds) }
        else if (view.phase === GamePhase.RASPASY_TALON_REVEAL) engine.revealNextRaspasyTalonCard()
        else if (view.phase === GamePhase.SCORING) engine.scoreHand()
        refresh()
      } catch (error) { setMessage(error instanceof Error ? error.message : 'La giocata non è valida.') }
    }, delayBase + Math.random() * 550)
    return () => clearTimeout(timer)
  }, [advancedAi, busy, engine, reducedMotion, refresh, revision, speed, view.currentPlayerId, view.phase])

  const humanCards = useMemo(() => { const cards = [...view.ownHand]; if (autoSort) return cards.sort((a, b) => Object.values(Suit).indexOf(a.suit) - Object.values(Suit).indexOf(b.suit) || b.numericStrength - a.numericStrength); return cards.sort((a, b) => manualOrder.indexOf(a.id) - manualOrder.indexOf(b.id)) }, [autoSort, manualOrder, view.ownHand])
  const legalIds = new Set(view.legalMoves.map(card => card.id)), canPlay = view.currentPlayerId === HUMAN && [GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING].includes(view.phase), isDiscard = view.phase === GamePhase.DECLARER_DISCARD && view.currentPlayerId === HUMAN
  const haptic = () => { if ('vibrate' in navigator) navigator.vibrate(12) }
  const playHumanCard = (cardId: string) => { if (!canPlay || !legalIds.has(cardId) || busy) { const lead = view.currentTrick?.cards[0]?.card.suit ?? view.currentTrick?.forcedLeadSuit; setMessage(lead ? `Devi rispondere a ${SUIT_SYMBOL[lead]}.` : busy ? 'Attendi la fine del movimento.' : 'Non è ancora il tuo turno.'); return } engine.playCard(HUMAN, cardId); setSelected([]); setMessage(''); haptic(); refresh() }
  const clickCard = (card: Card) => { if (isDiscard) { setSelected(current => current.includes(card.id) ? current.filter(id => id !== card.id) : current.length < 2 ? [...current, card.id] : current); haptic(); return } if (!canPlay || !legalIds.has(card.id)) { playHumanCard(card.id); return } if (selected.includes(card.id)) playHumanCard(card.id); else { setSelected([card.id]); haptic() } }
  const moveManual = (direction: -1 | 1) => { if (selected.length !== 1) return; const id = selected[0]!; setManualOrder(order => { const next = [...order], index = next.indexOf(id), target = Math.max(0, Math.min(next.length - 1, index + direction)); next.splice(index, 1); next.splice(target, 0, id); return next }) }
  const confirmDiscard = () => { if (selected.length !== 2 || busy) return; engine.discard(HUMAN, [selected[0]!, selected[1]!]); setSelected([]); setMessage(''); refresh() }
  const nextHand = () => { engine.nextHand(); setSelected([]); setMessage(''); refresh() }
  const resetGame = () => { if (!confirm('Ricominciare la partita?')) return; engineRef.current = newEngine(poolTarget); presentationRef.current = new GamePresentationController(); botsRef.current = newBots(); advisorRef.current = new AdvancedBotAdvisor({ enabled: advancedAi, mode: advancedMode, maxCallsPerHand: 4, maxCallsPerGame: 40, budgetLimitUsd: .25, timeoutMs: 4000 }); recordedHands.current.clear(); setSelected([]); setMessage(''); setRevision(value => value + 1); setAnimationRevision(value => value + 1) }
  const summary = resultSummary(view), contractText = view.contract ? view.contract.kind === ContractKind.MIZER ? 'Mizer' : `${view.contract.level}${suitLabel(view.contract.trump)}` : view.phase.toString().startsWith('RASPASY') ? `Raspasy ×${view.raspasyValue}` : 'Asta'
  const tableCards = view.currentTrick?.cards ?? (animation?.kind === 'CAPTURE_TRICK' ? view.completedTricks.at(-1)?.cards ?? [] : [])
  const animatedDiscards = animation?.kind === 'DISCARD_SEQUENCE' ? animation.event.data.cards as Card[] | undefined : undefined

  return <section className={`game-table-page speed-${speed} ${reducedMotion ? 'reduced-motion' : ''}`} data-phase={view.phase}>
    <header className="g-topbar"><button className="g-menu-button" onClick={onBack} aria-label="Torna al menu" title="Torna al menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h11v18H4zM15 12h5M18 9l3 3-3 3M7 12h.01"/></svg></button><div><span>Preferans Soči</span><strong>Mano {view.handNumber}</strong></div><nav><button className="g-settings-button" onClick={() => setSettingsOpen(value => !value)} aria-label="Impostazioni" aria-expanded={settingsOpen}>⚙</button></nav></header>
    {settingsOpen && <aside className="g-settings"><label>Velocità<select value={speed} onChange={event => setSpeed(event.target.value as GameSpeed)}><option value="slow">Lenta</option><option value="normal">Normale</option><option value="fast">Veloce</option></select></label><label className="g-ai-toggle"><input type="checkbox" checked={advancedAi} onChange={event => setAdvancedAi(event.target.checked)}/> AI avanzata {advancedAi ? 'attiva' : 'disattiva'}</label><label>Modalità AI<select value={advancedMode} disabled={!advancedAi} onChange={event => setAdvancedMode(event.target.value as AdvancedAiMode)}><option value={AdvancedAiMode.CONSERVATIVE}>Conservative</option><option value={AdvancedAiMode.BALANCED}>Balanced</option><option value={AdvancedAiMode.CREATIVE}>Creative</option></select></label>{advancedAi && <small className="g-ai-status">{advisorRef.current.stats.requests} richieste · ${advisorRef.current.stats.estimatedCostUsd.toFixed(4)} stimati</small>}<button onClick={() => setMuted(value => !value)}>{muted ? 'Audio spento' : 'Audio basso'}</button><button onClick={() => setAutoSort(value => !value)}>Ordine {autoSort ? 'automatico' : 'manuale'}</button><button onClick={() => { presentation.queue.skipCurrentAnimation(); setAnimationRevision(value => value + 1) }}>Salta movimento</button><button onClick={() => { presentation.queue.skipAllAnimations(); setAnimationRevision(value => value + 1) }}>Salta tutto</button><button className="g-danger" onClick={resetGame}>Ricomincia</button></aside>}
    <div className={`g-table ${animation ? `anim-${animation.kind.toLowerCase()}` : ''}`}>
      <PinnedScoreboard view={view} poolTarget={poolTarget}/>
      <div className="g-deck" aria-label="Mazzo"><PlayingCard face="back" compact/><PlayingCard face="back" compact/></div>
      <Opponent id={BOT_LEFT} side="left" view={view} animation={animation}/><Opponent id={BOT_RIGHT} side="right" view={view} animation={animation}/>
      <section className="g-center" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); playHumanCard(event.dataTransfer.getData('text/card-id')) }}>
        <div className="g-contract-chip"><strong>{contractText}</strong><small>{view.contract ? `${nameOf(view.contract.declarerId)} · ${view.contract.trump === 'NT' ? 'senza briscola' : `briscola ${SUIT_SYMBOL[view.contract.trump]}`}` : view.phase === GamePhase.BIDDING ? 'dichiarazioni in corso' : 'nessuna briscola'}</small></div>
        {view.defenseMode === DefenseMode.ONE_VIST_OPEN && <div className="g-open-vist">Vist aperto</div>}
        <div className="g-talon" data-testid="talon" aria-label={view.revealedTalon.length ? 'Tallone rivelato' : 'Tallone coperto'}>{(view.revealedTalon.length ? view.revealedTalon : [undefined, undefined]).map((card, index) => <PlayingCard key={card?.id ?? `talon-${index}`} card={card} face={card ? 'front' : 'back'} compact animation={animation?.kind === 'FLIP_TALON' ? 'playing' : undefined}/>)}{view.phase === GamePhase.RASPASY_PLAYING && view.currentTrick?.forcedLeadSuit && <small>Tallone: seme richiesto {SUIT_SYMBOL[view.currentTrick.forcedLeadSuit]}</small>}</div>
        <div className="g-current-trick" data-testid="current-trick">{tableCards.map(play => <div key={play.playerId} className={`g-played-card from-${play.playerId}`}><PlayingCard card={play.card} animation={animation?.kind === 'CAPTURE_TRICK' ? 'captured' : 'playing'}/><small>{nameOf(play.playerId)}</small></div>)}</div>
        {animatedDiscards && <div className="g-discard-ghost" aria-label="Scarti coperti">{animatedDiscards.map(card => <PlayingCard key={card.id} card={card} animation="captured" compact/>)}</div>}
        {animation?.kind === 'CAPTURE_TRICK' && <div className="g-winner-flash">Presa a {nameOf(animation.event.data.winnerId as string)}</div>}
      </section>
      <section className={`g-human ${view.currentPlayerId === HUMAN ? 'is-turn' : ''} ${view.contract?.declarerId === HUMAN ? 'is-declarer' : ''}`}><header><div><span className="g-avatar">T</span><div><strong>Tu</strong><small>{view.tricksWon[HUMAN]} prese · {view.ownHand.length} carte</small></div></div><div className="g-role-row">{view.contract?.declarerId === HUMAN && <span>Dichiarante</span>}{view.defenderDecisions[HUMAN] && <span>{view.defenderDecisions[HUMAN]}</span>}</div></header><div className="g-human-hand" aria-label="La tua mano">{humanCards.map((card, index) => <div key={card.id} style={{ '--card-index': index, '--card-count': humanCards.length, '--deal-index': index } as React.CSSProperties}><PlayingCard card={card} selected={selected.includes(card.id)} playable={canPlay && legalIds.has(card.id)} disabled={(canPlay && !legalIds.has(card.id)) || (!canPlay && !isDiscard)} animation={animation?.kind === 'DEAL_SEQUENCE' ? 'dealing' : undefined} onClick={() => clickCard(card)} onDragStart={event => event.dataTransfer.setData('text/card-id', card.id)}/></div>)}</div>{!autoSort && selected.length === 1 && <div className="g-manual-order"><button onClick={() => moveManual(-1)}>← Sposta</button><button onClick={() => moveManual(1)}>Sposta →</button></div>}</section>
      <AuctionPanel view={view} onAction={action => { engine.makeBid(HUMAN, action); haptic(); refresh() }}/><DefenderPanel view={view} onDecision={decision => { engine.makeDefenderDecision(HUMAN, decision); haptic(); refresh() }}/>
      {isDiscard && <section className="g-decision-panel g-discard-panel"><div><span>Tallone vinto</span><strong>Hai vinto la prima presa: scarta 2 carte</strong><small>{selected.length}/2 · qualsiasi carta è consentita</small></div><button disabled={selected.length !== 2 || busy} onClick={confirmDiscard}>Scarta</button></section>}
      {message && <div className="g-toast" role="status">{message}</div>}{busy && <button className="g-skip" onClick={() => { presentation.queue.skipAllAnimations(); setAnimationRevision(value => value + 1) }}>Salta animazioni</button>}
      {[GamePhase.HAND_COMPLETE, GamePhase.GAME_COMPLETE].includes(view.phase) && <section className="g-hand-summary" role="dialog" aria-label="Riepilogo mano"><span>Mano conclusa</span><h2>{summary.title}</h2>{summary.lines.map(line => <p key={line}>{line}</p>)}{view.phase === GamePhase.HAND_COMPLETE ? <button onClick={nextHand}>Mano successiva →</button> : <button onClick={resetGame}>Nuova partita</button>}</section>}
    </div>
    <div className="g-debug" hidden={import.meta.env.PROD}><b>DEBUG</b> {view.phase} · {view.currentPlayerId ?? '—'} · legal {view.legalMoves.length} · queue {presentation.queue.snapshot().length}</div>
  </section>
}
