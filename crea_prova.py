#!/usr/bin/env python3
"""Genera la versione di PROVA dell'app HRV Tool a partire da index.html.

Perche' esiste: l'app pubblicata su https://fsposini.github.io/respiro-pacer/ e'
installata sui telefoni dei pazienti e il service worker e' network-first, quindi
ogni push arriva a loro da solo. Per provare una modifica sull'iPhone PRIMA di
pubblicarla serve un secondo indirizzo, sullo stesso sito (Web Bluetooth richiede
HTTPS: un server locale su IP di rete NON basta, la fascia non si aggancia).

    https://fsposini.github.io/respiro-pacer/        -> pazienti  (index.html)
    https://fsposini.github.io/respiro-pacer/prova/  -> solo Federico (generata qui)

Uso:  python crea_prova.py
Poi:  git add prova; git commit; git push   -> l'indirizzo di prova e' aggiornato.
      I pazienti non vedono nulla: il loro index.html non e' stato toccato.

La copia NON e' modificata a mano: si rigenera da index.html a ogni prova, cosi'
non puo' divergere dall'originale.
"""
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
SRC = BASE / "index.html"
OUT_DIR = BASE / "prova"
OUT = OUT_DIR / "index.html"

# ---------------------------------------------------------------------------
# Chiavi localStorage da ISOLARE.
#
# localStorage e' per ORIGINE, non per cartella: /prova/ e la app vera condividono
# lo stesso spazio sul telefono. Quindi le prove sovrascriverebbero i dati veri.
# Isolo solo gli STORICI CLINICI, che sono il patrimonio da non sporcare —
# in particolare morning.v1, che contiene la baseline a 60 giorni del test del
# mattino: qualche misura di prova la falserebbe per settimane.
ISOLA = [
    "respiroPacer.hrv.v1",            # sessioni HRV registrate
    "respiroPacer.morning.v1",        # storico test del mattino = BASELINE 60 gg
    "respiroPacer.morningPos.v1",     # posizione fissa della misura del mattino
    "respiroPacer.morningPosMigr.v1", # stato della migrazione della baseline
    "respiroPacer.alpha.v1",          # storico DFA alpha1
    "respiroPacer.risonanza.v1",      # test di frequenza di risonanza
]
# Chiavi lasciate IN COMUNE di proposito:
#   license.v1 / deviceId.v1  -> la licenza e' legata a UN dispositivo. Isolarle
#       farebbe chiedere una nuova attivazione dalla copia di prova, che
#       rileghererebbe il codice a un "altro" dispositivo e potrebbe far cadere
#       l'attivazione dell'app vera sullo stesso telefono. E' lo stesso
#       dispositivo: deve restare la stessa licenza.
#   testProfile / settings / voiceName / *Consent -> preferenze e consensi, non
#       dati clinici: condividerli evita di reinserire tutto a ogni prova.
PREFISSO = "PROVA-"


def sostituisci(testo, vecchio, nuovo, attese=None, etichetta=""):
    """Sostituzione verificata: se il conteggio non torna, si ferma."""
    n = testo.count(vecchio)
    if n == 0:
        sys.exit(f"ERRORE: non trovato in index.html -> {etichetta or vecchio!r}")
    if attese is not None and n != attese:
        sys.exit(f"ERRORE: {etichetta or vecchio!r} trovato {n} volte, attese {attese}")
    return testo.replace(vecchio, nuovo), n


def main():
    if not SRC.exists():
        sys.exit(f"ERRORE: non trovo {SRC}")
    html = SRC.read_text(encoding="utf-8")
    passi = []

    # 1) Isolamento dei dati clinici -----------------------------------------
    for chiave in ISOLA:
        html, n = sostituisci(
            html, f"'{chiave}'", f"'{PREFISSO}{chiave}'", etichetta=f"chiave {chiave}"
        )
        passi.append(f"isolata la chiave {chiave} ({n} occorrenza/e)")

    # 2) Niente service worker ------------------------------------------------
    # Un SW registrato qui non servirebbe (la prova si fa da connessi) e
    # aggiungerebbe una cache in piu' da svuotare a ogni giro.
    html, _ = sostituisci(
        html,
        "navigator.serviceWorker.register('sw.js').catch(()=>{});",
        "/* versione di prova: nessun service worker, si legge sempre dalla rete */",
        attese=1,
        etichetta="registrazione service worker",
    )
    passi.append("rimossa la registrazione del service worker")

    # 3) Non installabile come app -------------------------------------------
    # Senza manifest, "Aggiungi a schermata Home" non crea una seconda icona
    # confondibile con l'app vera: la prova si apre dal link, e basta.
    html, _ = sostituisci(
        html,
        '<link rel="manifest" href="manifest.webmanifest">',
        "<!-- versione di prova: nessun manifest, non installabile -->",
        attese=1,
        etichetta="link al manifest",
    )
    html = html.replace(
        '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
        "<!-- versione di prova: nessuna icona -->",
    )
    passi.append("resa non installabile (manifest e icona rimossi)")

    # 4) Etichette inequivocabili --------------------------------------------
    html, _ = sostituisci(html, "<title>", "<title>PROVA · ", attese=1, etichetta="titolo")
    html, n = re.subn(r"(ver\.textContent = 'build v\d+)'", r"\1 · PROVA'", html)
    if n != 1:
        sys.exit("ERRORE: etichetta 'build vNN' non trovata (o trovata piu' volte)")
    passi.append("titolo e numero di build marcati PROVA")

    # 5) Fascia di avviso sempre visibile ------------------------------------
    # Deve essere impossibile confondere le due versioni guardando lo schermo.
    banner = """
<div id="provaBanner" style="position:sticky;top:0;z-index:99999;background:#8a2f24;color:#fff;
  padding:8px 12px;font:600 13px/1.35 system-ui,-apple-system,sans-serif;text-align:center;
  box-shadow:0 2px 8px rgba(0,0,0,.35)">
  VERSIONE DI PROVA — non e' l'app dei pazienti<br>
  <span style="font-weight:400;opacity:.92">Gli storici (mattino, &alpha;1, sessioni) sono separati da quelli veri.
  I dati inviati al medico finiscono invece nel foglio reale: usa un codice di prova.</span>
</div>
"""
    html, _ = sostituisci(html, "<body>", "<body>" + banner, attese=1, etichetta="tag body")
    passi.append("aggiunta la fascia di avviso in cima")

    OUT_DIR.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")

    print(f"Generata: {OUT.relative_to(BASE.parent)}")
    for p in passi:
        print(f"  - {p}")
    print("\nOra:  git add prova; git commit -m 'aggiorna versione di prova'; git push")
    print("Poi:  https://fsposini.github.io/respiro-pacer/prova/")


if __name__ == "__main__":
    main()
