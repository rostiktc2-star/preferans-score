import { finalize } from '../domain/finalize'
import { formatFraction } from '../domain/fraction'
import type { GameState } from '../domain/types'

const money = (cents: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100)
const eventType = (type: string) => type === 'mizer' ? 'Mizer' : type === 'raspasy' ? 'Raspasy' : type === 'normal' ? 'Contratto' : 'Correzione'
export const exportPdf = async (state: GameState, completeHistory: boolean): Promise<void> => {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' }); const name = (id: string) => state.config.players.find(p => p.id === id)?.name ?? id
  doc.setProperties({ title: 'Preferans Score', subject: 'Riepilogo della partita' }); doc.setTextColor(7, 26, 56); doc.setFontSize(22); doc.text('Preferans Score', 14, 18)
  doc.setFontSize(10); doc.text(`Partita del ${new Date(state.config.createdAt).toLocaleString('it-IT')}`, 14, 25); doc.text(`Posti in senso orario: ${state.config.players.map(p => p.name).join(' · ')}`, 14, 31); doc.text(`Obiettivo Pozzo: ${state.config.poolTarget}  |  Un Credito: ${money(state.config.euroCentsPerCredit)}`, 14, 37)
  autoTable(doc, { startY: 43, head: [['Giocatore', 'Pozzo', 'Multa', 'Stato']], body: state.config.players.map(p => [p.name, state.scores[p.id]!.pool, state.scores[p.id]!.penalty, state.scores[p.id]!.pool === state.config.poolTarget ? 'chiuso' : 'aperto']), theme: 'grid', headStyles: { fillColor: [11, 99, 246] } })
  autoTable(doc, { head: [['Possiede', 'Contro', 'Crediti']], body: state.config.players.flatMap(a => state.config.players.filter(b => b.id !== a.id).map(b => [a.name, b.name, formatFraction(state.credits[a.id]![b.id]!, 4)])), theme: 'striped', headStyles: { fillColor: [7, 26, 56] } })
  const result = finalize(state)
  doc.addPage(); doc.setFontSize(17); doc.text('Risultato finale', 14, 18)
  doc.setFontSize(9); doc.text(`Multa minima sottratta: ${result.minimumPenalty}. Le frazioni sono mantenute esatte; solo gli euro sono bilanciati ai centesimi.`, 14, 25)
  autoTable(doc, { startY: 30, head: [['#', 'Giocatore', 'Multa residua', 'Crediti netti', 'Euro']], body: result.players.map((p, i) => [i + 1, name(p.playerId), p.residualPenalty, formatFraction(p.netCredits, 4), money(p.euroCents)]), theme: 'grid', headStyles: { fillColor: [11, 99, 246] } })
  autoTable(doc, { head: [['Pagamenti minimi']], body: result.payments.length ? result.payments.map(p => [`${name(p.fromId)} paga ${money(p.cents)}  a ${name(p.toId)}`]) : [['Nessun pagamento']], theme: 'striped' })
  const aids = state.applied.flatMap(a => a.aids.map(x => [`Mano ${a.handNumber || '—'}`, name(x.donorId), name(x.recipientId), `${x.poolPoints} Pozzo`, `${x.credits} Crediti`]))
  if (aids.length) autoTable(doc, { head: [['Evento', 'Aiuta', 'Riceve', 'Punti', 'Debito']], body: aids, headStyles: { fillColor: [176, 32, 48] } })
  doc.addPage(); doc.setFontSize(17); doc.text(completeHistory ? 'Cronologia completa' : 'Cronologia sintetica', 14, 18)
  autoTable(doc, { startY: 24, head: [['Mano', 'Data', 'Tipo', 'Riepilogo', 'Riposo', 'Raspasy']], body: state.applied.map(a => [a.handNumber || '-', new Date(a.event.createdAt).toLocaleString('it-IT'), eventType(a.event.type), a.summary, a.restPlayerId ? name(a.restPlayerId) : '-', `${a.raspasyBefore} -> ${a.raspasyAfter}`]), styles: { fontSize: 7, overflow: 'linebreak' }, columnStyles: { 3: { cellWidth: completeHistory ? 70 : 82 } }, headStyles: { fillColor: [7, 26, 56] } })
  if (completeHistory) for (const a of state.applied) { const lines = [...Object.entries(a.poolChanges).filter(([, v]) => v).map(([id, v]) => `${name(id)} Pozzo ${v! > 0 ? '+' : ''}${v}`), ...Object.entries(a.penaltyChanges).filter(([, v]) => v).map(([id, v]) => `${name(id)} Multa ${v! > 0 ? '+' : ''}${v}`), ...a.creditChanges.map(c => `${name(c.fromId)} contro ${name(c.againstId)}: ${formatFraction(c.amount)} Crediti (${c.reason})`)]; if (lines.length) autoTable(doc, { head: [[`Dettaglio ${a.event.type === 'manual' ? 'correzione' : `mano ${a.handNumber}`}`]], body: lines.map(x => [x]), styles: { fontSize: 8 }, margin: { left: 20 } }) }
  doc.save(`preferans-score-${new Date().toISOString().slice(0, 10)}.pdf`)
}
