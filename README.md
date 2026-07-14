# Preferans Score

Applicazione web mobile-first per registrare una partita reale di Preferans secondo la variante Soči personalizzata inclusa nel progetto. Funziona con 3 o 4 partecipanti, conserva tutto sul dispositivo, è installabile come PWA e può essere pubblicata gratuitamente su GitHub Pages.

Le regole sono state confrontate con il documento “Manuale Preferans - Soči 3 Giocatori”. In caso di conflitto prevale la specifica applicativa: in particolare il premio per zero prese nei raspasy è sempre `+1 Pozzo` e un contratto con entrambi i difensori passanti non azzera la progressione.

## Funzioni principali

- wizard per contratto normale, mizer, raspasy e correzione manuale;
- calcolo automatico di Pozzo, Multa, Crediti direzionali e aiuto americano;
- riposo a rotazione nella modalità a quattro;
- replay deterministico della cronologia, modifica, eliminazione, undo e redo;
- calcolo finale con frazioni esatte, euro bilanciati ai centesimi e pagamenti minimi;
- backup JSON e riepilogo PDF, generati localmente;
- manuale tecnico ricercabile e guida “Impara a giocare”;
- menu iniziale con accesso diretto a partita, guida e manuale, più istruzioni di installazione su iPhone;
- manifest, service worker, cache offline e aggiornamento PWA esplicito.

## Avvio locale

Richiede Node.js 20 o superiore e pnpm.

```bash
pnpm install
pnpm dev
```

Aprire l’indirizzo mostrato da Vite. Per provare esattamente la build statica:

```bash
pnpm build
pnpm preview
```

## Verifiche

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

I test coprono contratti e difesa, polvist, mizer, raspasy, aiuto americano, riposo, replay, persistenza, frazioni finali, arrotondamento e settlement. La build usa `base: './'`, quindi gli asset funzionano anche sotto il percorso di un repository GitHub Pages.

## Pubblicazione su GitHub Pages

1. Creare un repository GitHub e inviare il branch `main`.
2. In **Settings → Pages**, scegliere **GitHub Actions** come sorgente.
3. Eseguire il workflow **Pubblica su GitHub Pages**, oppure fare push su `main`.

Il workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) esegue test e build, poi pubblica `dist`. Non servono backend, segreti, API key o servizi esterni.

## Architettura

- `src/domain/types.ts`: schema dati versionato e tipi degli eventi;
- `src/domain/engine.ts`: scoring puro, aiuto americano, rotazione e replay;
- `src/domain/fraction.ts`: aritmetica razionale deterministica;
- `src/domain/finalize.ts`: Multa finale, Crediti netti, centesimi e pagamenti;
- `src/domain/persistence.ts`: serializzazione e storage locale;
- `src/services/pdf.ts`: PDF nel browser;
- `src/content/manual.ts`: contenuti del manuale e della guida;
- `src/App.tsx`: flussi UI e gestione della partita.

La configurazione e la sequenza di eventi immutabili sono la fonte dei dati. Pozzo, Multa, Crediti, livello raspasy, rotazione e chiusura vengono sempre ricostruiti dall’inizio. Una modifica storica non altera quindi “a mano” i totali successivi.

## Schema dei dati locali

La chiave `preferans-score:game:v1` contiene un oggetto JSON:

```text
SavedGame {
  schemaVersion: 1
  config: GameConfig
  events: GameEvent[]
  undone: GameEvent[]
  updatedAt: ISO-8601
}
```

Ogni evento conserva data, tipo, giocatori, eventuale riposo, decisioni, prese e correzioni. Gli identificativi dei giocatori restano stabili anche se si cambiano i nomi.

## Esattezza e arrotondamenti

I Crediti derivanti dalla Multa a quattro giocatori sono frazioni ridotte, non numeri floating point. La conversione monetaria avviene una sola volta. Si troncano inizialmente i valori verso zero e si distribuiscono i centesimi mancanti in ordine deterministico in base al resto; la somma finale resta sempre `€0,00`. I pagamenti ricostruiscono esattamente quei saldi.

## Recupero e cancellazione

- **Recupero automatico:** riaprire l’app sullo stesso browser e dispositivo.
- **Backup:** sezione **Dati → Esporta backup**; per ripristinare usare **Importa backup**.
- **Fine partita:** usa **Menu → Termina partita** oppure **Dati → Termina e cambia giocatori**, con conferma. Si torna al menu iniziale e da **Gioca** si possono inserire nuovi partecipanti; esporta prima un backup se vuoi conservare la sessione.
- Gli aggiornamenti del service worker non cancellano la chiave locale.

## Dipendenze e licenze

Codice applicativo: licenza MIT (vedere `LICENSE`). Dipendenze dirette, tutte open source:

- React e React DOM — MIT;
- Vite e `@vitejs/plugin-react` — MIT;
- TypeScript — Apache-2.0;
- Vitest — MIT;
- `vite-plugin-pwa` e Workbox — MIT;
- jsPDF e jsPDF-AutoTable — MIT;
- ESLint e relativi plugin — MIT.

Non vengono caricati font, immagini, analytics o API da servizi remoti. Le icone sono originali e incluse nel repository.
