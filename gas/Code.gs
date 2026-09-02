/**
 * 家計簿DB API (Google Apps Script Web App)
 *
 * セットアップ手順:
 * 1. https://script.google.com で新規プロジェクトを作成し、このファイルの内容を貼り付ける
 * 2. エディタ上部で関数 `setup` を選択して実行（初回は権限承認が必要）
 * 3. 実行ログに表示される スプレッドシートURL と APIトークン を控える
 * 4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *    - 実行ユーザー: 自分
 *    - アクセスできるユーザー: 全員
 * 5. 発行された ウェブアプリURL と APIトークン をPWAの設定画面に入力する
 */

var SHEET_DEFS = {
  assets: ['date', 'investment', 'cash', 'pension', 'mf_profit', 'memo', 'monthly_gain'],
  expenses: ['month', 'category', 'amount'],
  fixed_costs: ['id', 'name', 'amount', 'frequency', 'start_month', 'end_month', 'memo'],
  income: ['month', 'salary', 'other', 'memo'],
  zaim_net: ['month', 'amount'],
  furusato_items: ['id', 'person', 'year', 'name', 'price', 'municipality', 'url', 'application_status', 'application_method', 'receipt_status', 'memo', 'market_price', 'priority'],
  // 注: 新列は必ず末尾に追加する（既存シートのデータ列とズレるため）
  furusato_years: ['person', 'year', 'income', 'social_insurance', 'medical_deduction', 'limit_manual', 'memo', 'bonus_base', 'bonus_config', 'life_paid', 'quake_paid', 'medical_paid'],
  furusato_salaries: ['person', 'year', 'month', 'gross', 'health', 'pension_ins', 'employment', 'income_tax', 'resident_tax', 'care_ins', 'other_income'],
  liabilities: ['id', 'name', 'kind', 'principal', 'start_month', 'rate', 'years', 'balance_manual', 'memo'],
  consumption: ['month', 'category', 'quantity'],
  memos: ['id', 'text', 'updated_at'],
  settings: ['key', 'value'],
};

/** 初回セットアップ: スプレッドシート作成 + トークン生成（エディタから手動実行） */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SPREADSHEET_ID');
  var ss;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
  } else {
    ss = SpreadsheetApp.create('家計簿DB');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  Object.keys(SHEET_DEFS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    var headers = SHEET_DEFS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });
  var defaultSheet = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);

  var token = props.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('API_TOKEN', token);
  }
  Logger.log('スプレッドシートURL: ' + ss.getUrl());
  Logger.log('APIトークン: ' + token);
}

// ---------------------------------------------------------------- HTTP entry

/**
 * 起動時の全データ取得。全12シートを読むので、短時間だけキャッシュして使い回す。
 * 書き込みのたびに破棄するので、自分の保存が古い値で上書きされて見えることはない。
 * fresh=1（アプリの↻ボタン）はキャッシュを素通しして必ず読み直す。
 */
var CACHE_KEY_ = 'all_v1';
var CACHE_SEC_ = 60;
/** CacheService の1件あたりの上限は100KB。余裕を見てこれを超えたらキャッシュしない */
var CACHE_MAX_ = 90 * 1024;

function dropCache_() {
  try {
    CacheService.getScriptCache().remove(CACHE_KEY_);
  } catch (e) {
    /* キャッシュが使えなくても本体の処理には影響させない */
  }
}

function doGet(e) {
  try {
    checkToken_(e.parameter.token);
    var fresh = e.parameter.fresh === '1';
    var cache = null;
    try {
      cache = CacheService.getScriptCache();
    } catch (e2) {
      cache = null;
    }
    if (!fresh && cache) {
      var hit = cache.get(CACHE_KEY_);
      if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
    }
    var body = JSON.stringify({ ok: true, data: getAllData_(), partial: false });
    if (cache && body.length <= CACHE_MAX_) {
      try {
        cache.put(CACHE_KEY_, body, CACHE_SEC_);
      } catch (e3) {
        /* 入らなくても支障はない */
      }
    }
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    checkToken_(body.token);
    var result = handleAction_(body);
    dropCache_(); // 書き込んだので起動時キャッシュは捨てる（次の取得で必ず最新になる）
    // result = { data: {...}, partial: true/false }
    return json_({ ok: true, data: result.data, partial: result.partial });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function handleAction_(body) {
  // 書き込み系は「触ったシートの内容」だけを返す（partial: true）。
  // 各ヘルパーが書き込み後の行を返すので、応答のためにシートを読み直さない。
  switch (body.action) {
    case 'all':
      return { data: getAllData_(), partial: false };
    case 'upsertAsset':
      return one_('assets', upsertRow_('assets', 'date', body.row));
    case 'deleteAsset':
      return one_('assets', deleteRows_('assets', function (r) { return r.date === body.date; }));
    case 'setExpense':
      return one_('expenses', isBlank_(body.row.amount)
        ? deleteRows_('expenses', function (r) { return r.month === body.row.month && r.category === body.row.category; })
        : upsertRow_('expenses', ['month', 'category'], body.row));
    case 'setIncome':
      return one_('income', upsertRow_('income', 'month', body.row));
    case 'setMonthData': // 1ヶ月分の収入+変動費(+消費量)をまとめて保存（PWAの収支入力用）
      return { data: applyMonths_([{ income: body.income, expenses: body.expenses, consumption: body.consumption }]), partial: true };
    case 'setMonthsData': // 複数月分の一括登録（CSVインポート用）
      return { data: applyMonths_(body.months || []), partial: true };
    case 'deleteIncome':
      return one_('income', deleteRows_('income', function (r) { return r.month === body.month; }));
    case 'saveFixedCost':
      if (!body.row.id) body.row.id = String(new Date().getTime());
      return one_('fixed_costs', upsertRow_('fixed_costs', 'id', body.row));
    case 'deleteFixedCost':
      return one_('fixed_costs', deleteRows_('fixed_costs', function (r) { return String(r.id) === String(body.id); }));
    case 'setZaimNet':
      return one_('zaim_net', upsertRow_('zaim_net', 'month', body.row));
    case 'setSetting':
      return one_('settings', upsertRow_('settings', 'key', body.row));
    case 'saveLiability':
      if (!body.row.id) body.row.id = String(new Date().getTime());
      return one_('liabilities', upsertRow_('liabilities', 'id', body.row));
    case 'deleteLiability':
      return one_('liabilities', deleteRows_('liabilities', function (r) { return String(r.id) === String(body.id); }));
    case 'saveMemo':
      if (!body.row.id) body.row.id = String(new Date().getTime());
      body.row.updated_at = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');
      return one_('memos', upsertRow_('memos', 'id', body.row));
    case 'deleteMemo':
      return one_('memos', deleteRows_('memos', function (r) { return String(r.id) === String(body.id); }));
    case 'saveFurusatoItem':
      if (!body.row.id) body.row.id = String(new Date().getTime());
      return one_('furusato_items', upsertRow_('furusato_items', 'id', body.row));
    case 'deleteFurusatoItem':
      return one_('furusato_items', deleteRows_('furusato_items', function (r) { return String(r.id) === String(body.id); }));
    case 'setFurusatoYear':
      return one_('furusato_years', upsertRow_('furusato_years', ['person', 'year'], body.row));
    case 'setFurusatoSalary':
      return one_('furusato_salaries', upsertRow_('furusato_salaries', ['person', 'year', 'month'], body.row));
    case 'setFurusatoSalaries': // 複数月の一括保存（他月コピー用）
      return one_('furusato_salaries', setFurusatoSalaries_(body.rows || []));
    case 'deleteFurusatoSalary':
      return one_('furusato_salaries', deleteRows_('furusato_salaries', function (r) {
        return r.person === body.person && String(r.year) === String(body.year) && String(r.month) === String(body.month);
      }));
    case 'renameFurusatoPerson': // 管理者名の変更（全ふるさと関連シートを一括書き換え）
      var ss = ss_();
      var renamed = {};
      ['furusato_items', 'furusato_years', 'furusato_salaries'].forEach(function (name) {
        var rows = readSheet_(ss, name);
        var changed = false;
        rows.forEach(function (r) {
          if (r.person === body.from) {
            r.person = body.to;
            changed = true;
          }
        });
        if (changed) rewriteSheet_(ss, name, rows);
        renamed[name] = outRows_(name, rows);
      });
      return { data: renamed, partial: true };
    case 'bulkImport':
      return { data: bulkImport_(body), partial: false };
    default:
      throw new Error('unknown action: ' + body.action);
  }
}

/** 1シートぶんの部分応答 */
function one_(name, rows) {
  var out = {};
  out[name] = rows;
  return { data: out, partial: true };
}

// ---------------------------------------------------------------- core

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected) throw new Error('setup 未実行です（API_TOKEN がありません）');
  if (!token || token !== expected) throw new Error('invalid token');
}

/** 1リクエスト中に何度も呼ばれるので、開いたスプレッドシートは使い回す */
var SS_CACHE_ = null;
function ss_() {
  if (SS_CACHE_) return SS_CACHE_;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('setup 未実行です（SPREADSHEET_ID がありません）');
  SS_CACHE_ = SpreadsheetApp.openById(id);
  return SS_CACHE_;
}

function getAllData_() {
  var ss = ss_();
  var out = {};
  Object.keys(SHEET_DEFS).forEach(function (name) {
    out[name] = readSheet_(ss, name);
  });
  return out;
}

function readSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var headers = SHEET_DEFS[name];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values
    .filter(function (row) { return row.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = normalize_(row[i], h); });
      return obj;
    });
}

/** Session.getScriptTimeZone() はセルごとに呼ぶと高くつくので1回だけ取って使い回す */
var TZ_ = null;
function tz_() {
  if (TZ_ === null) TZ_ = Session.getScriptTimeZone();
  return TZ_;
}

function normalize_(v, header) {
  if (v instanceof Date) {
    var fmt = header === 'month' || header === 'start_month' || header === 'end_month' ? 'yyyy-MM' : 'yyyy-MM-dd';
    return Utilities.formatDate(v, tz_(), fmt);
  }
  if (v === '') return null;
  return v;
}

/** keyCols(文字列 or 配列)が一致する行を更新、なければ追加 */
function upsertRow_(sheetName, keyCols, rowObj) {
  var keys = Array.isArray(keyCols) ? keyCols : [keyCols];
  var ss = ss_();
  var sheet = ss.getSheetByName(sheetName);
  var headers = SHEET_DEFS[sheetName];
  var newRow = headers.map(function (h) {
    var v = rowObj[h];
    return v === undefined || v === null ? '' : v;
  });
  var existing = readSheet_(ss, sheetName);
  for (var i = 0; i < existing.length; i++) {
    var match = keys.every(function (k) { return String(existing[i][k]) === String(rowObj[k]); });
    if (match) {
      sheet.getRange(i + 2, 1, 1, headers.length).setValues([newRow]);
      existing[i] = rowObj;
      return outRows_(sheetName, existing);
    }
  }
  sheet.appendRow(newRow);
  existing.push(rowObj);
  return outRows_(sheetName, existing);
}

function deleteRows_(sheetName, predicate) {
  var ss = ss_();
  var sheet = ss.getSheetByName(sheetName);
  var rows = readSheet_(ss, sheetName);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (predicate(rows[i])) sheet.deleteRow(i + 2);
  }
  return outRows_(sheetName, rows.filter(function (r) { return !predicate(r); }));
}

/** 一括投入（既存Excelからの移行用）。mode: 'replace'(既定) or 'append' */
function bulkImport_(body) {
  var ss = ss_();
  var counts = {};
  Object.keys(SHEET_DEFS).forEach(function (name) {
    var rows = body[name];
    if (!rows || !rows.length) return;
    var sheet = ss.getSheetByName(name);
    var headers = SHEET_DEFS[name];
    if (body.mode !== 'append' && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
    var values = rows.map(function (r) {
      return headers.map(function (h) {
        var v = r[h];
        return v === undefined || v === null ? '' : v;
      });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
    counts[name] = values.length;
  });
  return { imported: counts };
}

/** 複数月分の income + expenses を一括反映（シート全体を読み→マージ→書き戻しで高速化） */
/**
 * 月ごとの収入・変動費・消費量をまとめて反映する。
 * 行ごとに upsertRow_ を呼ぶとその都度シートを丸ごと読み直してしまうため、
 * 「必要なシートを1回読む → メモリで差し替え → 1回書き戻す」形にしている。
 * 戻り値は書き込んだシートの内容（応答にそのまま使うので読み直さない）。
 */
function applyMonths_(months) {
  var ss = ss_();
  var need = { income: false, expenses: false, consumption: false };
  months.forEach(function (m) {
    if (m.income) need.income = true;
    if (m.expenses && m.expenses.length) need.expenses = true;
    if (m.consumption && m.consumption.length) need.consumption = true;
  });

  var rows = {};
  ['income', 'expenses', 'consumption'].forEach(function (n) {
    if (need[n]) rows[n] = readSheet_(ss, n);
  });

  var same = function (a, b) { return String(a) === String(b); };
  var replace = function (list, row, valueCol) {
    var out = list.filter(function (r) {
      return !(same(r.month, row.month) && same(r.category, row.category));
    });
    if (!isBlank_(row[valueCol])) out.push(row);
    return out;
  };

  months.forEach(function (m) {
    if (m.income) {
      rows.income = rows.income.filter(function (r) { return !same(r.month, m.income.month); });
      rows.income.push(m.income);
    }
    (m.expenses || []).forEach(function (row) { rows.expenses = replace(rows.expenses, row, 'amount'); });
    (m.consumption || []).forEach(function (row) { rows.consumption = replace(rows.consumption, row, 'quantity'); });
  });

  var out = {};
  if (need.income) {
    rows.income.sort(function (a, b) { return String(a.month).localeCompare(String(b.month)); });
    rewriteSheet_(ss, 'income', rows.income);
    out.income = outRows_('income', rows.income);
  }
  ['expenses', 'consumption'].forEach(function (n) {
    if (!need[n]) return;
    rows[n].sort(function (a, b) {
      return String(a.month).localeCompare(String(b.month)) || String(a.category).localeCompare(String(b.category));
    });
    rewriteSheet_(ss, n, rows[n]);
    out[n] = outRows_(n, rows[n]);
  });
  return out;
}

/** 複数月の給与をまとめて反映（シート読み書き1回で処理） */
function setFurusatoSalaries_(newRows) {
  var ss = ss_();
  var rows = readSheet_(ss, 'furusato_salaries');
  newRows.forEach(function (nr) {
    rows = rows.filter(function (r) {
      return !(r.person === nr.person && String(r.year) === String(nr.year) && String(r.month) === String(nr.month));
    });
    rows.push(nr);
  });
  rows.sort(function (a, b) {
    return String(a.person).localeCompare(String(b.person)) || (a.year - b.year) || (a.month - b.month);
  });
  rewriteSheet_(ss, 'furusato_salaries', rows);
  return outRows_('furusato_salaries', rows);
}

/**
 * rows を2行目以降へ一括で書き戻す。
 * 全行を消してから書き直すのではなく「定義列だけ setValues して、余った行だけ削る」ので、
 * シートの右側に手で足した列は消えない。
 */
function rewriteSheet_(ss, name, rows) {
  var sheet = ss.getSheetByName(name);
  var headers = SHEET_DEFS[name];
  var lastRow = sheet.getLastRow();
  if (rows.length) {
    var values = rows.map(function (r) {
      return headers.map(function (h) {
        var v = r[h];
        return v === undefined || v === null ? '' : v;
      });
    });
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
  var surplus = lastRow - 1 - rows.length;
  if (surplus > 0) sheet.deleteRows(2 + rows.length, surplus);
}

/** 空欄扱いの値か */
function isBlank_(v) {
  return v === null || v === undefined || v === '';
}

/**
 * 書き込んだ行を「シートから読み直したときと同じ形」に整える（空文字→null）。
 * 応答をこの形に揃えておかないと、保存直後の画面とリロード後の画面で値の表現がズレる。
 */
function outRows_(name, rows) {
  var headers = SHEET_DEFS[name];
  return rows.map(function (r) {
    var o = {};
    headers.forEach(function (h) {
      o[h] = isBlank_(r[h]) ? null : r[h];
    });
    return o;
  });
}

// ---------------------------------------------------------------- メール自動取り込み

/**
 * マネーフォワードの定期レポートメール（週次など）から資産総額を読み取り、assets に自動記録する。
 *
 * 使い方:
 * 1. マネーフォワード MEの設定でメール配信（ウィークリーメール）をONにする
 * 2. GASエディタでこの関数を一度手動実行して Gmail の権限を承認する
 * 3. エディタ左メニュー「トリガー」→「トリガーを追加」→ 関数 importFromMail /
 *    イベントのソース「時間主導型」/ 「日付ベースのタイマー」で1日1回に設定
 *
 * 仕様:
 * - 処理済みスレッドには Gmail ラベル「kakeibo取込済」を付けて重複を防ぐ
 * - マネフォの「資産総額」は年金を含むため、年金額が本文から取れた場合は 投資=総額−年金 とする
 * - 同じ日付の既存記録（ブックマークレットで入れた現金など）にはマージする
 * - メール本文の書式が想定と違って取れない場合はログに本文の先頭を出力する（正規表現の調整用）
 */
function importFromMail() {
  var LABEL = 'kakeibo取込済';
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search('from:(moneyforward.com) -label:' + LABEL + ' newer_than:30d');
  var imported = 0;
  threads.forEach(function (thread) {
    var done = false;
    thread.getMessages().forEach(function (msg) {
      var body = msg.getPlainBody() || '';
      var total = matchAmount_(body, /(?:資産総額|総資産)[^0-9\-]{0,20}([0-9,]+)\s*円/);
      if (total === null) {
        Logger.log('金額を検出できませんでした: ' + msg.getSubject());
        Logger.log(body.slice(0, 500));
        return;
      }
      var pension = matchAmount_(body, /年金[^0-9\-]{0,20}([0-9,]+)\s*円/);
      var date = Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      var row = {
        date: date,
        investment: pension !== null ? total - pension : total,
        pension: pension,
        memo: 'メール自動取込',
      };
      mergeAssetRow_(row);
      imported++;
      done = true;
    });
    if (done) thread.addLabel(label);
  });
  Logger.log('取込件数: ' + imported);
  return imported;
}

function matchAmount_(text, re) {
  var m = text.match(re);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** 同じ日付の既存行があれば null でない項目だけ上書きしてマージ */
function mergeAssetRow_(row) {
  var ss = ss_();
  var existing = readSheet_(ss, 'assets').filter(function (r) { return r.date === row.date; })[0];
  var merged = existing || {};
  Object.keys(row).forEach(function (k) {
    if (row[k] !== null && row[k] !== undefined) merged[k] = row[k];
  });
  merged.date = row.date;
  upsertRow_('assets', 'date', merged);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
