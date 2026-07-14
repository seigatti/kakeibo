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
  assets: ['date', 'investment', 'cash', 'pension', 'mf_profit', 'memo'],
  expenses: ['month', 'category', 'amount'],
  fixed_costs: ['id', 'name', 'amount', 'frequency', 'start_month', 'end_month', 'memo'],
  income: ['month', 'salary', 'other', 'memo'],
  zaim_net: ['month', 'amount'],
  furusato_items: ['id', 'person', 'year', 'name', 'price', 'municipality', 'url', 'application_status', 'application_method', 'receipt_status', 'memo'],
  // 注: 新列は必ず末尾に追加する（既存シートのデータ列とズレるため）
  furusato_years: ['person', 'year', 'income', 'social_insurance', 'medical_deduction', 'limit_manual', 'memo', 'bonus_base', 'bonus_config'],
  furusato_salaries: ['person', 'year', 'month', 'gross', 'health', 'pension_ins', 'employment', 'income_tax', 'resident_tax'],
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

function doGet(e) {
  try {
    checkToken_(e.parameter.token);
    return json_({ ok: true, data: getAllData_() });
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
    return json_({ ok: true, data: result });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function handleAction_(body) {
  switch (body.action) {
    case 'all':
      return getAllData_();
    case 'upsertAsset':
      upsertRow_('assets', 'date', body.row);
      return getAllData_();
    case 'deleteAsset':
      deleteRows_('assets', function (r) { return r.date === body.date; });
      return getAllData_();
    case 'setExpense':
      if (body.row.amount === null || body.row.amount === '' || body.row.amount === undefined) {
        deleteRows_('expenses', function (r) { return r.month === body.row.month && r.category === body.row.category; });
      } else {
        upsertRow_('expenses', ['month', 'category'], body.row);
      }
      return getAllData_();
    case 'setIncome':
      upsertRow_('income', 'month', body.row);
      return getAllData_();
    case 'setMonthData': // 1ヶ月分の収入+変動費をまとめて保存（PWAの収支入力用）
      if (body.income) upsertRow_('income', 'month', body.income);
      (body.expenses || []).forEach(function (row) {
        if (row.amount === null || row.amount === '' || row.amount === undefined) {
          deleteRows_('expenses', function (r) { return r.month === row.month && r.category === row.category; });
        } else {
          upsertRow_('expenses', ['month', 'category'], row);
        }
      });
      return getAllData_();
    case 'setMonthsData': // 複数月分の一括登録（CSVインポート用）
      setMonthsData_(body.months || []);
      return getAllData_();
    case 'deleteIncome':
      deleteRows_('income', function (r) { return r.month === body.month; });
      return getAllData_();
    case 'saveFixedCost':
      if (!body.row.id) body.row.id = String(new Date().getTime());
      upsertRow_('fixed_costs', 'id', body.row);
      return getAllData_();
    case 'deleteFixedCost':
      deleteRows_('fixed_costs', function (r) { return String(r.id) === String(body.id); });
      return getAllData_();
    case 'setZaimNet':
      upsertRow_('zaim_net', 'month', body.row);
      return getAllData_();
    case 'setSetting':
      upsertRow_('settings', 'key', body.row);
      return getAllData_();
    case 'saveFurusatoItem':
      if (!body.row.id) body.row.id = String(new Date().getTime());
      upsertRow_('furusato_items', 'id', body.row);
      return getAllData_();
    case 'deleteFurusatoItem':
      deleteRows_('furusato_items', function (r) { return String(r.id) === String(body.id); });
      return getAllData_();
    case 'setFurusatoYear':
      upsertRow_('furusato_years', ['person', 'year'], body.row);
      return getAllData_();
    case 'setFurusatoSalary':
      upsertRow_('furusato_salaries', ['person', 'year', 'month'], body.row);
      return getAllData_();
    case 'deleteFurusatoSalary':
      deleteRows_('furusato_salaries', function (r) {
        return r.person === body.person && String(r.year) === String(body.year) && String(r.month) === String(body.month);
      });
      return getAllData_();
    case 'renameFurusatoPerson': // 管理者名の変更（全ふるさと関連シートを一括書き換え）
      ['furusato_items', 'furusato_years', 'furusato_salaries'].forEach(function (name) {
        var ss = ss_();
        var rows = readSheet_(ss, name);
        var changed = false;
        rows.forEach(function (r) {
          if (r.person === body.from) {
            r.person = body.to;
            changed = true;
          }
        });
        if (changed) rewriteSheet_(ss, name, rows);
      });
      return getAllData_();
    case 'bulkImport':
      return bulkImport_(body);
    default:
      throw new Error('unknown action: ' + body.action);
  }
}

// ---------------------------------------------------------------- core

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected) throw new Error('setup 未実行です（API_TOKEN がありません）');
  if (!token || token !== expected) throw new Error('invalid token');
}

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('setup 未実行です（SPREADSHEET_ID がありません）');
  return SpreadsheetApp.openById(id);
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

function normalize_(v, header) {
  if (v instanceof Date) {
    var fmt = header === 'month' || header === 'start_month' || header === 'end_month' ? 'yyyy-MM' : 'yyyy-MM-dd';
    return Utilities.formatDate(v, Session.getScriptTimeZone(), fmt);
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
      return;
    }
  }
  sheet.appendRow(newRow);
}

function deleteRows_(sheetName, predicate) {
  var ss = ss_();
  var sheet = ss.getSheetByName(sheetName);
  var rows = readSheet_(ss, sheetName);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (predicate(rows[i])) sheet.deleteRow(i + 2);
  }
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
function setMonthsData_(months) {
  var ss = ss_();
  var incomeRows = readSheet_(ss, 'income');
  var expenseRows = readSheet_(ss, 'expenses');
  months.forEach(function (m) {
    if (m.income) {
      incomeRows = incomeRows.filter(function (r) { return r.month !== m.income.month; });
      incomeRows.push(m.income);
    }
    (m.expenses || []).forEach(function (row) {
      expenseRows = expenseRows.filter(function (r) { return !(r.month === row.month && r.category === row.category); });
      if (row.amount !== null && row.amount !== undefined && row.amount !== '') expenseRows.push(row);
    });
  });
  incomeRows.sort(function (a, b) { return String(a.month).localeCompare(String(b.month)); });
  expenseRows.sort(function (a, b) {
    return String(a.month).localeCompare(String(b.month)) || String(a.category).localeCompare(String(b.category));
  });
  rewriteSheet_(ss, 'income', incomeRows);
  rewriteSheet_(ss, 'expenses', expenseRows);
}

function rewriteSheet_(ss, name, rows) {
  var sheet = ss.getSheetByName(name);
  var headers = SHEET_DEFS[name];
  if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  if (!rows.length) return;
  var values = rows.map(function (r) {
    return headers.map(function (h) {
      var v = r[h];
      return v === undefined || v === null ? '' : v;
    });
  });
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
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
