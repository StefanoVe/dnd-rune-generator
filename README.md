# D&D Rune Generator

Generatore Angular di rune concentriche deterministiche basate sui parametri degli incantesimi D&D 2024. Ogni runa si legge dal centro verso il sigillo esterno.

## Chiave di lettura

| Parametro        | Segno visivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo di danno    | Colore dell'intera runa; «variabile» usa una sfumatura, «nessuno» inchiostro scuro.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Scuola           | Runa della scuola al centro, senza nulla attorno.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Livello          | Figura attorno al nucleo: trucchetto = nessuna, livello 1 = cerchio, livello 2 = linea obliqua che taglia la runa, livello n ≥ 3 = poligono regolare di n lati con un lato in alto (3 = triangolo … 9 = ennagono). Più il livello è alto, più la runa è faticosa da tracciare: dal 4 un nodo su ogni vertice, dal 6 una stella {n/2} che unisce i vertici, dal 7 la runa della scuola dentro ogni nodo e una seconda fascia di glifi rivolta verso il centro.                                                                               |
| Area             | Figura inscritta attorno alla figura di livello (con un vertice in alto): sfera = cerchio tratteggiato, cono = triangolo, cubo = rombo, quadrato = quadrato, cilindro = doppio anello con traversine, linea = barre orizzontali, emanazione = raggi corti, personalizzata = esagramma, nessuna = nessuna figura.                                                                                                                                                                                                                            |
| Gittata          | Raggi agganciati alla figura di livello (dal bordo verso l'esterno; al livello 2 a pettine, perpendicolari alla linea obliqua; al livello 0 scendono dal sigillo esterno verso il centro): sé = solo piccoli anelli accostati alla figura di livello (alla linea obliqua al livello 2, al sigillo per i trucchetti), contatto = brevissimi, distanza = più si avvicinano alla fascia esterna più è lontano (scala logaritmica da 5 ft a un miglio), vista = cerchietti terminali, illimitata = fino al sigillo, speciale = uncino in punta. |
| Misura dell'area | Numero di raggi di gittata: 4 senza area, poi 6 (5 ft), 8 (10), 10 (15), 12 (20), 14 (30), 16 (fino a 60), 18 (oltre).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Tempo di lancio  | Anello di glifi senza cornice, appena dentro il sigillo: lo stesso glifo ripetuto 16 volte (con un vuoto dove passa un raggio), la cui forma indica il tipo di lancio.                                                                                                                                                                                                                                                                                                                                                                      |
| Istanze          | Il glifo della scuola è ripetuto in cerchio una volta per istanza creata al livello base (raggi, dardi o bersagli), fino a 12; una sola istanza = un glifo grande.                                                                                                                                                                                                                                                                                                                                                                          |
| Concentrazione   | Quattro cerchi con pupilla fuori dal sigillo, sulle diagonali.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Rituale          | Quattro rombi fuori dal sigillo, sui punti cardinali.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

L'anteprima offre una guida di costruzione dal nucleo al sigillo. L'SVG scaricato contiene la runa completa su sfondo trasparente e non contiene testo. Tutte le linee hanno lo stesso spessore; il glifo centrale è una figura piena.

I colori mantengono almeno 3:1 di contrasto sulla carta `#eee2c5`.

**Crediti:** rune delle scuole da Jim McKeeth, https://github.com/jimmckeeth/Fantasy-RPG-Art (ricreazione delle icone delle scuole di D&D Beyond; il repository non indica una licenza esplicita, quindi verificare i diritti prima di un deploy pubblico).

## Sviluppo

```bash
bun install
bun run catalog:sync
bun start
```

Lo snapshot generato contiene esclusivamente metadati. Per usare un catalogo in un percorso differente:

```bash
node scripts/sync-spell-catalog.mjs --source=/percorso/al/catalog/dnd-2024
```

## Verifica e deploy

```bash
bun run test
bun run build
bun run deploy:package
CAPROVER_SERVER=notify bun run deploy:caprover
```

Il deploy usa il nome applicazione CapRover fisso `rune-generator`. Il catalogo completo deriva da una fonte che richiede la verifica dei diritti di redistribuzione prima della pubblicazione pubblica; le descrizioni delle spell non vengono distribuite.
