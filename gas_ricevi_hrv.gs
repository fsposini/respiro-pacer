/**
 * Ricevitore dei test HRV inviati da Respiro Pacer.
 * Deposita ogni CSV nel Drive del Dott. Sposini, in un'unica cartella.
 *
 * I dati arrivano PSEUDONIMIZZATI (solo codice paziente, nessun nome): il legame
 * codice→paziente resta sul PC del medico. Lo script gira sotto l'account Google
 * del medico → nessun server di terzi.
 *
 * ───────── COME PUBBLICARLO (una volta sola) ─────────
 * 1. Vai su https://script.google.com → Nuovo progetto. Incolla questo file.
 * 2. In Drive crea una cartella, es. "HRV pazienti". Aprila e copia l'ID dall'URL
 *    (la parte dopo /folders/…). Incollalo qui sotto in FOLDER_ID.
 * 3. Distribuisci → Nuova distribuzione → tipo "App web".
 *      - Esegui come: Me stesso (il tuo account)
 *      - Chi ha accesso: Chiunque
 *    Autorizza quando richiesto. Copia l'URL che finisce con /exec.
 * 4. Incolla quell'URL in respiro-pacer-app/index.html nella costante
 *    DOCTOR_UPLOAD_URL, poi fai il deploy dell'app (commit + push) e ricarica
 *    Respiro Pacer su iPhone.
 *
 * Per aggiornare lo script in futuro: Distribuisci → Gestisci distribuzioni →
 * matita → Nuova versione (così l'URL /exec resta lo stesso).
 */

var FOLDER_ID = '1rxRFjDMlJ9y5Teo607LEa-BjtI66PaYA';   // ← cartella Drive "HRV pazienti"

function doPost(e) {
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    var kind    = p.kind    || 'test';
    var code    = p.code    || 'senza-codice';
    var consent = p.consent || '';
    var ts      = p.ts      || new Date().toISOString();

    if (consent !== '1') return _json({ ok: false, error: 'consenso mancante' });

    var folder = DriveApp.getFolderById(FOLDER_ID);

    // ── Allenamento di COERENZA: una riga sul foglio "coerenza_pazienti" ──
    // Nessun file per sessione (eviterebbe di intasare la cartella). Solo metriche
    // pseudonimizzate: codice paziente + parametri dell'allenamento, nessun dato clinico.
    if (kind === 'coerenza') {
      var row = [
        p.local || ts, code, p.durata_min || '', p.atti_min || '',
        p.coh_media || '', p.pct_coerenza || '', p.coh_picco || '',
        p.fc_media || '', p.sorgente || '', p.campioni || '', ts
      ];
      _cohRow(folder, row);
      return _json({ ok: true, kind: 'coerenza' });
    }

    // ── DFA α1 (misura a riposo): una riga sul foglio "alpha1_atleti" ──
    if (kind === 'alpha1') {
      var arow = [
        p.local || ts, code, p.alpha1 || '', p.fc_media || '',
        p.n_battiti || '', p.n_esclusi || '', p.durata_min || '', ts
      ];
      _sheetRow(folder, 'alpha1_atleti',
        ['data e ora', 'codice', 'alpha1', 'FC media', 'battiti', 'esclusi', 'durata (min)', 'ts ISO'],
        arow);
      return _json({ ok: true, kind: 'alpha1' });
    }

    // ── Test HRV clinico: un file CSV per test (comportamento originale) ──
    var csv     = p.data    || '';
    var fname   = (p.fname  || 'test_HRV.csv').replace(/[^A-Za-z0-9_.\-]/g, '_');
    if (!csv) return _json({ ok: false, error: 'nessun dato' });
    var blob = Utilities.newBlob(csv, 'text/csv', fname);
    var file = folder.createFile(blob);
    file.setDescription('Paziente ' + code + ' · consenso ' + consent + ' · ' + ts);

    // Log di audit in un foglio "registro" nella stessa cartella (creato al volo).
    _logRow(folder, [ts, code, fname, file.getId()]);

    return _json({ ok: true, id: file.getId() });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doGet() {                       // verifica rapida che l'app sia viva
  return _json({ ok: true, service: 'ricevi-hrv' });
}

// Accoda una riga a un foglio dedicato (creato al volo nella stessa cartella, con
// intestazione se nuovo). Usato per i cruscotti coerenza/α1: una riga per sessione,
// il medico vede a colpo d'occhio l'attività di ogni paziente/atleta nel tempo.
function _sheetRow(folder, name, header, row) {
  var it = folder.getFilesByName(name);
  var ss;
  if (it.hasNext()) ss = SpreadsheetApp.open(it.next());
  else {
    ss = SpreadsheetApp.create(name);
    var f = DriveApp.getFileById(ss.getId());
    folder.addFile(f); DriveApp.getRootFolder().removeFile(f);
    ss.getActiveSheet().appendRow(header);
  }
  ss.getActiveSheet().appendRow(row);
}

function _cohRow(folder, row) {
  _sheetRow(folder, 'coerenza_pazienti',
    ['data e ora', 'codice', 'durata (min)', 'atti/min',
     'coerenza media', '% in coerenza', 'coerenza picco',
     'FC media', 'sorgente', 'campioni', 'ts ISO'],
    row);
}

function _logRow(folder, row) {
  try {
    var it = folder.getFilesByName('registro_invii_hrv');
    var ss;
    if (it.hasNext()) ss = SpreadsheetApp.open(it.next());
    else {
      ss = SpreadsheetApp.create('registro_invii_hrv');
      var f = DriveApp.getFileById(ss.getId());
      folder.addFile(f); DriveApp.getRootFolder().removeFile(f);
      ss.getActiveSheet().appendRow(['timestamp', 'codice', 'file', 'fileId']);
    }
    ss.getActiveSheet().appendRow(row);
  } catch (_) {}
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
