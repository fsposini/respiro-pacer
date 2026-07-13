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

// ── Avviso readiness su Telegram (stesso bot della segreteria; chat del medico) ──
// Quando un atleta la mattina ha la readiness in "Recupero", il medico riceve un
// messaggio sulla propria chat con il SOLO codice pseudonimo, così può decidere di
// contattarlo (decodifica codice→nome in locale su registro.html). Nessun dato a terzi.
//
// ⚠️ Il token del bot NON va scritto qui: questo repository è PUBBLICO. Impostalo una
// volta sola in Apps Script → ⚙️ Impostazioni progetto → Proprietà script → aggiungi
// una proprietà con chiave  TELEGRAM_TOKEN  e valore il token dato da BotFather.
function _telegramToken(){ return PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN') || ''; }
var TELEGRAM_CHAT_ID = '7174842868';   // id della chat del medico (non è un segreto)

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
        p.fc_media || '', p.sorgente || '', p.campioni || '', ts,
        p.rmssd || '', p.lf_pct || '', p.hf_pct || ''   // ← RMSSD, LF%, HF% (fascia)
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

    // ── Test del mattino (READINESS): una riga sul foglio "readiness_atleti" ──
    // + avviso Telegram al medico quando il verdetto è "Recupero" (alert=1).
    if (kind === 'readiness') {
      var rrow = [
        p.local || ts, code, p.verdetto || '', p.lnrmssd || '',
        p.rmssd || '', p.base_rmssd || '', p.fc_media || '', p.alert || '0', ts
      ];
      _sheetRow(folder, 'readiness_atleti',
        ['data e ora', 'codice', 'verdetto', 'lnRMSSD', 'RMSSD', 'RMSSD base', 'FC media', 'alert', 'ts ISO'],
        rrow);
      if (p.alert === '1') _notifyReadiness(code, p);
      return _json({ ok: true, kind: 'readiness' });
    }

    // ── Test della FREQUENZA DI RISONANZA ──
    // Sweep di frequenze respiratorie: una riga per frequenza sul foglio
    // "risonanza_pazienti" + la foto PNG dell'onda di quella frequenza salvata come
    // file nella cartella. A fine test una riga di esito su "risonanza_esiti" con la
    // frequenza di risonanza (picco LF). Tutto pseudonimizzato: solo il codice.
    if (kind === 'risonanza') {
      if (p.esito === '1') {
        _sheetRow(folder, 'risonanza_esiti',
          ['data e ora', 'codice', 'sessione', 'n frequenze',
           'risonanza sec/lato', 'risonanza atti/min', 'LF picco (ms2)', 'LF picco (Hz)', 'ts ISO'],
          [ts, code, p.sess || '', p.n_blocchi || '',
           p.ris_sec_lato || '', p.ris_atti_min || '', p.ris_lf || '', p.ris_lf_picco_hz || '', ts]);
        return _json({ ok: true, kind: 'risonanza', esito: true });
      }
      // riga per singola frequenza (blocco)
      _sheetRow(folder, 'risonanza_pazienti',
        ['data e ora', 'codice', 'sessione', 'blocco', 'n frequenze', 'sec/lato', 'atti/min',
         'LF (ms2)', 'LF picco (Hz)', 'HF (ms2)', 'VLF (ms2)', 'LF/HF', 'LF%', 'HF%',
         'FC media', 'RMSSD', 'battiti', 'ts ISO'],
        [p.local || ts, code, p.sess || '', p.blocco || '', p.n_blocchi || '',
         p.sec_lato || '', p.atti_min || '', p.lf || '', p.lf_picco_hz || '', p.hf || '',
         p.vlf || '', p.lf_hf || '', p.lf_pct || '', p.hf_pct || '',
         p.fc_media || '', p.rmssd || '', p.battiti || '', ts]);
      // foto "occhiometrica" dell'onda del blocco (data URL PNG → file nella cartella)
      if (p.png && p.png.indexOf('data:image') === 0) {
        try {
          var imgBytes = Utilities.base64Decode(p.png.split(',')[1]);
          var imgName = ('risonanza_' + code + '_' + (p.sess || '') + '_blocco' + (p.blocco || '') + '.png')
            .replace(/[^A-Za-z0-9_.\-]/g, '_');
          var imgBlob = Utilities.newBlob(imgBytes, 'image/png', imgName);
          var imgFile = folder.createFile(imgBlob);
          imgFile.setDescription('Risonanza · paziente ' + code + ' · ' + (p.sec_lato || '') + ' s/lato · ' + ts);
        } catch (imgErr) {}
      }
      return _json({ ok: true, kind: 'risonanza' });
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

function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};

  // ── Attivazione licenza (JSONP): l'app chiede se il codice è valido e libero su
  //    questo dispositivo. JSONP perché Apps Script non espone header CORS: così il
  //    browser (anche Bluefy su iPhone) legge la risposta senza problemi.
  if (p.kind === 'activate') {
    var result = _activate(p.code || '', p.device || '');
    if (p.callback) {
      return ContentService
        .createTextOutput(p.callback + '(' + JSON.stringify(result) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return _json(result);
  }

  return _json({ ok: true, service: 'ricevi-hrv' });   // verifica rapida che l'app sia viva
}

// ─────────────────────── ATTIVAZIONE / LICENZE ───────────────────────
// Foglio "licenze" nella cartella HRV pazienti. Una riga per paziente, preparata dal
// medico. Colonne: codice · pseudonimo · stato · max_dispositivi · dispositivi ·
// data_attivazione · ultimo_accesso.  Il medico compila codice/pseudonimo/stato
// (max_dispositivi opzionale, default 1); le altre si riempiono da sole.
//  • stato "attivo" (o vuoto) = utilizzabile · "revocato"/"sospeso" = bloccato
//  • primo dispositivo che si presenta → viene legato al codice
//  • un dispositivo diverso, oltre il limite → rifiutato (niente condivisione)
// Gestione: si modifica il foglio a mano (svuotare "dispositivi" = reset per nuovo
// telefono; stato "revocato" = chiudere l'accesso).
function _activate(code, device) {
  code = String(code || '').trim().toUpperCase();
  device = String(device || '').trim();
  if (!code)   return { ok: false, reason: 'nocode',   error: 'Codice mancante.' };
  if (!device) return { ok: false, reason: 'nodevice', error: 'Dispositivo non identificato.' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) {}
  try {
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var ss = _openSheet(folder, 'licenze',
      ['codice', 'pseudonimo', 'stato', 'max_dispositivi', 'dispositivi', 'data_attivazione', 'ultimo_accesso']);
    var sheet = ss.getActiveSheet();
    var data = sheet.getDataRange().getValues();
    var C = 0, STATO = 2, MAX = 3, DISP = 4, DATA = 5, LAST = 6;   // indici colonna (0-based)

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][C]).trim().toUpperCase() !== code) continue;

      var stato = String(data[r][STATO] || 'attivo').trim().toLowerCase();
      if (stato === 'revocato' || stato === 'sospeso' || stato === 'bloccato')
        return { ok: false, reason: 'revoked', error: 'Codice non più attivo. Contatta il medico.' };

      var maxDev = parseInt(data[r][MAX], 10); if (!maxDev || maxDev < 1) maxDev = 1;
      var devs = String(data[r][DISP] || '').split(',').map(function (x) { return x.trim(); }).filter(String);
      var now = new Date();

      if (devs.indexOf(device) >= 0) {                    // già legato a questo dispositivo → ok
        sheet.getRange(r + 1, LAST + 1).setValue(now);
        return { ok: true, token: _token(code, device), pseudonimo: data[r][1] };
      }
      if (devs.length < maxDev) {                         // c'è ancora posto → lega questo dispositivo
        devs.push(device);
        sheet.getRange(r + 1, DISP + 1).setValue(devs.join(','));
        if (!data[r][DATA]) sheet.getRange(r + 1, DATA + 1).setValue(now);
        sheet.getRange(r + 1, LAST + 1).setValue(now);
        return { ok: true, token: _token(code, device), pseudonimo: data[r][1] };
      }
      return { ok: false, reason: 'otherdevice', error: 'Codice già attivato su un altro dispositivo. Contatta il medico.' };
    }
    return { ok: false, reason: 'notfound', error: 'Codice non valido.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Prova (firma) che il server ha detto sì. Non è una barriera crittografica: la
// protezione reale è il legame codice→dispositivo nel foglio, verificato dal server.
function _token(code, device) {
  var secret = PropertiesService.getScriptProperties().getProperty('LICENSE_SECRET') || 'respiro-pacer';
  var bytes = Utilities.computeHmacSha256Signature(code + '|' + device, secret);
  return Utilities.base64EncodeWebSafe(bytes);
}

// Da lanciare UNA volta dall'editor Apps Script (menu ▶ Esegui) per creare il foglio
// "licenze" già pronto con le intestazioni. Poi apri il foglio nella cartella HRV
// pazienti e aggiungi una riga per ogni paziente: codice, pseudonimo, stato "attivo".
function creaFoglioLicenze() {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  _openSheet(folder, 'licenze',
    ['codice', 'pseudonimo', 'stato', 'max_dispositivi', 'dispositivi', 'data_attivazione', 'ultimo_accesso']);
}

// Apre (o crea) un foglio dedicato nella cartella, con intestazione se nuovo.
function _openSheet(folder, name, header) {
  var it = folder.getFilesByName(name), ss;
  if (it.hasNext()) { ss = SpreadsheetApp.open(it.next()); }
  else {
    ss = SpreadsheetApp.create(name);
    var f = DriveApp.getFileById(ss.getId());
    folder.addFile(f); DriveApp.getRootFolder().removeFile(f);
    ss.getActiveSheet().appendRow(header);
  }
  return ss;
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
  var sheet = ss.getActiveSheet();
  // Se il foglio esisteva già con meno colonne, aggiunge in coda le intestazioni
  // mancanti (es. le nuove RMSSD/LF%/HF%): così non serve toccarle a mano.
  var lastCol = sheet.getLastColumn();
  if (lastCol > 0 && lastCol < header.length) {
    sheet.getRange(1, lastCol + 1, 1, header.length - lastCol)
         .setValues([header.slice(lastCol)]);
  }
  sheet.appendRow(row);
}

function _cohRow(folder, row) {
  _sheetRow(folder, 'coerenza_pazienti',
    ['data e ora', 'codice', 'durata (min)', 'atti/min',
     'coerenza media', '% in coerenza', 'coerenza picco',
     'FC media', 'sorgente', 'campioni', 'ts ISO',
     'RMSSD (ms)', 'LF%', 'HF%'],   // ← colonne aggiunte (solo per le righe "fascia")
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

// Avvisa il medico su Telegram che un atleta ha la readiness in calo. Un solo avviso
// per atleta al giorno (dedup con Script Properties): se ripete la misura, niente doppioni.
function _notifyReadiness(code, p) {
  try {
    var props = PropertiesService.getScriptProperties();
    var day = String(p.local || '').slice(0, 10);          // YYYY-MM-DD
    var key = 'ready_' + code + '_' + day;
    if (props.getProperty(key)) return;                     // già avvisato oggi per questo atleta

    var token = _telegramToken();
    if (!token) return;                                     // token non ancora impostato nelle Proprietà script
    props.setProperty(key, '1');

    var msg = '🔴 <b>Readiness in calo</b>\n'
      + 'Atleta <b>' + code + '</b>\n'
      + 'RMSSD ' + (p.rmssd || '?') + ' ms · sua media ' + (p.base_rmssd || '?') + ' ms\n'
      + 'Verdetto: <b>' + (p.verdetto || 'Recupero') + '</b>\n'
      + (p.local || '') + '\n\n'
      + 'Valuta se contattare l\'atleta (decodifica il codice su registro.html).';

    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' }),
      muteHttpExceptions: true,
    });
  } catch (_) {}
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
