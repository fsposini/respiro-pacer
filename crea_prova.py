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
    "respiroPacer.testOutbox.v1",     # test clinico registrato e non ancora inviato:
                                      # e' un dato clinico vero (gli IBI del tonico), e
                                      # un test fatto in prova non deve comparire come
                                      # "da inviare" nell'app vera, ne' viceversa.
    "respiroPacer.cohFeedback.v1",    # storico coerenza per il feedback motivazionale
    "respiroPacer.cohFeedbackLast.v1",# ultima frase mostrata (per non ripeterla)
    "respiroPacer.weekReport.v1",     # settimana di cui si e' gia' visto il riepilogo:
                                      # se NON fosse isolata, provarlo qui lo spegnerebbe
                                      # per quella settimana anche nell'app vera.
    "respiroPacer.weekReportLast.v1", # ultima frase settimanale usata per scenario
    "respiroPacer.seenVer.v1",        # versione di cui si e' gia' vista la nota delle novita':
                                      # se NON fosse isolata, provare la nota qui la
                                      # spegnerebbe anche nell'app vera dello stesso telefono.
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

    # 6) Banco di prova del riepilogo settimanale ----------------------------
    # Il riquadro settimanale compare solo al primo avvio di una settimana NUOVA e
    # parla della settimana CHIUSA. Sulla prova gli storici sono isolati e quindi
    # vuoti: senza questo pannello non si potrebbe vedere il riquadro se non
    # aspettando settimane. I tasti riempiono lo storico ISOLATO (mai quello vero)
    # con una settimana finta e richiamano WeekReport.init().
    # Sta qui e NON in index.html di proposito: e' impalcatura di collaudo, non deve
    # esistere nell'app dei pazienti nemmeno nascosta.
    banco = """
  <div id="bancoSettimana" style="border:1px dashed #8a2f24;border-radius:12px;padding:11px 12px;margin-bottom:16px">
    <div style="font:700 .78rem system-ui;color:#e08b7d;margin-bottom:3px">Banco di prova · riepilogo settimanale</div>
    <div style="font:400 .7rem/1.4 system-ui;color:#8fb0c9;margin-bottom:8px">
      Riempie lo storico <b>di prova</b> con una settimana finta e mostra il riquadro.
      Non tocca il tuo storico vero.</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px" id="bancoTasti"></div>
  </div>
"""
    ancora = '    <button type="button" class="wk-ok" id="weekOk">Ho visto</button>\n  </div>'
    html, _ = sostituisci(html, ancora, ancora + banco, attese=1,
                          etichetta="chiusura del riquadro settimanale")

    script_banco = """
/* ---- Banco di prova del riepilogo settimanale (SOLO versione di prova) ---- */
(function(){
  const tasti = document.getElementById('bancoTasti'); if(!tasti) return;
  const P = 'PROVA-respiroPacer.';
  function lun(d){ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; }
  const L0=lun(new Date());
  const L1=new Date(L0); L1.setDate(L1.getDate()-7);    // settimana chiusa (quella del report)
  const L2=new Date(L0); L2.setDate(L2.getDate()-14);   // quella prima
  function sedute(lunedi,n,coh){ const o=[]; for(let i=0;i<n;i++){
    const d=new Date(lunedi); d.setDate(d.getDate()+i); d.setHours(10,0,0,0);
    o.push({ts:d.toISOString(), coh:coh, min:5}); } return o; }
  function giorni(lunedi,n){ const o=[]; for(let i=0;i<n;i++){
    const d=new Date(lunedi); d.setDate(d.getDate()+i);
    o.push({ d:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),
             ts:d.toISOString(), rmssd:40, alpha:1.05 }); } return o; }
  const CASI = [
    ['Prima settimana', ()=>({coh:sedute(L1,4,70),                          morn:giorni(L1,2)})],
    ['Poche sedute',    ()=>({coh:sedute(L2,4,70).concat(sedute(L1,2,72)),  morn:giorni(L1,1)})],
    ['Miglioramento',   ()=>({coh:sedute(L2,4,60).concat(sedute(L1,4,72)),  morn:giorni(L1,3), alpha:giorni(L1,1)})],
    ['Stazionario',     ()=>({coh:sedute(L2,4,60).concat(sedute(L1,4,61)),  morn:giorni(L1,3)})],
    ['Leggero calo',    ()=>({coh:sedute(L2,4,60).concat(sedute(L1,4,51)),  morn:giorni(L1,2)})],
    ['Settimana vuota', ()=>({coh:sedute(L2,4,70),                          morn:[]})]
  ];
  function applica(fn){
    const s = fn();
    try{
      localStorage.setItem(P+'cohFeedback.v1', JSON.stringify(s.coh||[]));
      localStorage.setItem(P+'morning.v1',     JSON.stringify(s.morn||[]));
      localStorage.setItem(P+'alpha.v1',       JSON.stringify(s.alpha||[]));
      localStorage.setItem(P+'risonanza.v1',   JSON.stringify([]));
      localStorage.removeItem(P+'weekReport.v1');     // torna "da mostrare"
    }catch(e){}
    const box=document.getElementById('weekBox'); if(box) box.style.display='none';
    if(window.WeekReport) WeekReport.init();
    if(box) box.scrollIntoView({behavior:'smooth', block:'center'});
  }
  CASI.forEach(([nome,fn])=>{
    const b=document.createElement('button');
    b.type='button'; b.textContent=nome;
    b.style.cssText='font:600 .72rem system-ui;padding:7px 9px;border-radius:8px;cursor:pointer;'
      +'border:1px solid #244563;background:#193249;color:#e8f1f8';
    b.addEventListener('click', ()=>applica(fn));
    tasti.appendChild(b);
  });
})();
"""
    html, _ = sostituisci(html, "\n/* ---------- SERVICE WORKER",
                          script_banco + "\n/* ---------- SERVICE WORKER",
                          attese=1, etichetta="blocco del service worker")
    passi.append("aggiunto il banco di prova del riepilogo settimanale (6 casi)")

    # 7) Riquadro «Monitoraggio 24 ore» nel menu (23/11/2026, SOLO nella copia di prova) ---------
    # Decisione di Federico: per ora tutto resta nella copia che usa lui; sull'app dei pazienti (index.html) non si tocca niente.
    # Nella copia il riquadro è SEMPRE attivo (altrimenti non potrebbe usare il diario). Con «?grigio=1» nell'indirizzo si vede
    # com'è per un paziente senza il pacchetto: grigio, non toccabile, «Da concordare con il medico».
    # Si apre la pagina del monitoraggio della COPIA (prova/app-24h.html), che torna a questo menu.
    tile = """
    <a href="app-24h.html" class="home-tile" id="homeMon24" style="grid-column:1/-1;text-decoration:none">
      <span class="ht-ico">⌚</span><b>Monitoraggio 24 ore</b><i>Diario e fascia H10, per più giorni</i>
    </a>"""
    html, _ = sostituisci(html, "    </button>\n  </div>\n  <div class=\"home-foot\">", "    </button>" + tile + "\n  </div>\n  <div class=\"home-foot\">",
                          attese=1, etichetta="fine del menu della Home")
    script_mon = """
/* ---- Riquadro «Monitoraggio 24 ore» (SOLO versione di prova) ---- */
(function(){
  const t = document.getElementById('homeMon24'); if(!t) return;
  if(new URLSearchParams(location.search).has('grigio')){      // come lo vedrebbe un paziente senza pacchetto
    t.setAttribute('aria-disabled','true'); t.removeAttribute('href');
    t.style.cssText += ';opacity:.45;pointer-events:none;cursor:not-allowed;filter:grayscale(1)';
    t.querySelector('i').textContent = 'Da concordare con il medico';
    return;
  }
  const RUNS = [['hrvTestRun','il test clinico','Interrompi'],['mornRun','il test del mattino','Interrompi'],
                ['alphaRun','la misura α1','Interrompi'],['camRun','l\\'allenamento con la fotocamera','Termina sessione']];
  t.addEventListener('click', e => {
    e.preventDefault();
    let w = null;
    if(document.body.dataset.running === '1') w = ['la sessione di respirazione','Stop'];
    else for(const [id, what, how] of RUNS){ const x = document.getElementById(id); if(x && x.style.display !== 'none'){ w = [what, how]; break; } }
    if(w){ alert('C\\'è ' + w[0] + ' in corso. Per aprire il monitoraggio chiudi prima con il tasto "' + w[1] + '".'); return; }
    let code = ''; try{ const P = JSON.parse(localStorage.getItem('respiroPacer.testProfile.v1') || 'null'); code = (P && P.code) || ''; }catch(x){}
    location.href = 'app-24h.html' + (code ? '?codice=' + encodeURIComponent(code) : '');
  });
})();
"""
    html, _ = sostituisci(html, "\n/* ---------- SERVICE WORKER", script_mon + "\n/* ---------- SERVICE WORKER", attese=1, etichetta="blocco del service worker (riquadro monitoraggio)")
    passi.append("aggiunto il riquadro «Monitoraggio 24 ore» nel menu (sempre attivo; ?grigio=1 per vedere la versione paziente)")

    # 8) Pagina del monitoraggio della copia: prova/app-24h.html, dalla versione in lavorazione (monitoraggio_24h/app-24h.html)
    PAG_SRC = BASE.parent / "monitoraggio_24h" / "app-24h.html"
    if not PAG_SRC.exists():
        sys.exit(f"ERRORE: non trovo {PAG_SRC}")
    pag = PAG_SRC.read_text(encoding="utf-8")
    pag, _ = sostituisci(pag, "<title>Monitoraggio 24 ore — HRV Tool</title>", "<title>PROVA · Monitoraggio 24 ore — HRV Tool</title>", attese=1, etichetta="titolo della pagina")
    pag, _ = sostituisci(pag, '<link rel="icon" href="icon-192.png">', '<link rel="icon" href="../icon-192.png">', attese=1, etichetta="icona della pagina")
    # la pagina deve essere quella rigenerata dal sorgente: se il sorgente è più nuovo, ci si ferma
    import subprocess
    try:
        r = subprocess.run(["node", "genera_app24.js", "--verifica"], cwd=str(PAG_SRC.parent), capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            sys.exit("ERRORE: monitoraggio_24h/app-24h.html non coincide con il sorgente: lancia «node genera_app24.js» e rifai la prova.\n" + r.stdout + r.stderr)
    except FileNotFoundError:
        print("  (node non trovato: non ho potuto controllare che la pagina coincida con il sorgente)")
    pag, _ = sostituisci(pag, "<body>", '<body><div style="background:#8a2f24;color:#fff;padding:6px 12px;font:600 12.5px/1.35 system-ui,sans-serif;text-align:center">VERSIONE DI PROVA — stessi dati del telefono e stesso Drive della pagina vera</div>', attese=1, etichetta="tag body della pagina")
    passi.append("generata prova/app-24h.html (copia della pagina del monitoraggio in lavorazione; stessi dati del telefono della pagina vera)")

    OUT_DIR.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    (OUT_DIR / "app-24h.html").write_text(pag, encoding="utf-8")

    print(f"Generata: {OUT.relative_to(BASE.parent)}")
    for p in passi:
        print(f"  - {p}")
    print("\nOra:  git add prova; git commit -m 'aggiorna versione di prova'; git push")
    print("Poi:  https://fsposini.github.io/respiro-pacer/prova/")


if __name__ == "__main__":
    main()
