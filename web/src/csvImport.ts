/**
 * Zaim Web版のエクスポートCSVを解析し、月×カテゴリの収支に集計する。
 * - 文字コードは UTF-8 / Shift_JIS を自動判定
 * - Zaimのカテゴリ（「カテゴリ/内訳」）→ アプリのカテゴリへの対応付けはユーザーが設定し、
 *   settings シート（key=csv_category_map）に保存して次回から自動適用する
 */

export interface ZaimTxn {
  month: string // YYYY-MM
  key: string // "カテゴリ/内訳" or "カテゴリ"
  income: number
  expense: number
}

export interface ZaimParsed {
  txns: ZaimTxn[]
  keys: string[] // 出現した対応付け対象キー
  months: string[]
}

/** 対応付け先の特殊ターゲット */
export const TARGET_SALARY = '給料'
export const TARGET_OTHER_INCOME = 'その他収入'
export const TARGET_IGNORE = '無視'

export function decodeCsv(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('shift_jis').decode(buf)
  }
}

/** クォート対応の簡易CSVパーサ */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuote = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuote = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

export function parseZaimCsv(buf: ArrayBuffer): ZaimParsed {
  const rows = parseCsv(decodeCsv(buf).replace(/^﻿/, ''))
  if (rows.length < 2) throw new Error('CSVにデータ行がありません')
  const header = rows[0]
  const col = (name: string) => {
    const exact = header.indexOf(name)
    if (exact >= 0) return exact
    return header.findIndex((h) => h.includes(name))
  }
  const iDate = col('日付')
  const iMethod = col('方法')
  const iGenre = col('カテゴリの内訳')
  const iCat = header.indexOf('カテゴリ') >= 0 ? header.indexOf('カテゴリ') : col('カテゴリ')
  const iIncome = col('収入')
  const iExpense = col('支出')
  if (iDate < 0 || iIncome < 0 || iExpense < 0) {
    throw new Error(`Zaim形式のCSVではないようです（ヘッダ: ${header.slice(0, 6).join(',')}…）`)
  }

  const txns: ZaimTxn[] = []
  for (const r of rows.slice(1)) {
    const date = (r[iDate] ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue
    const method = iMethod >= 0 ? (r[iMethod] ?? '').trim() : ''
    if (method === '振替' || method === 'transfer') continue
    const num = (s: string | undefined) => {
      const n = Number((s ?? '').replace(/[,，¥￥]/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    const income = num(r[iIncome])
    const expense = num(r[iExpense])
    if (income === 0 && expense === 0) continue
    const cat = iCat >= 0 ? (r[iCat] ?? '').trim() : ''
    const genre = iGenre >= 0 ? (r[iGenre] ?? '').trim() : ''
    const key = genre && genre !== '-' ? `${cat}/${genre}` : cat || '（カテゴリなし）'
    txns.push({ month: date.slice(0, 7), key, income, expense })
  }
  const keys = [...new Set(txns.map((t) => t.key))].sort()
  const months = [...new Set(txns.map((t) => t.month))].sort()
  return { txns, keys, months }
}

/** キー名からの初期マッピング推定 */
export function defaultMapping(parsed: ZaimParsed, categories: string[], saved: Record<string, string>): Record<string, string> {
  const hints: Array<[string, string]> = [
    ['ガス', 'ガス代'],
    ['電気', '電気代'],
    ['水道', '上下水道'],
    ['ガソリン', 'ガソリン代'],
    ['高速', '高速料金'],
    ['ETC', '高速料金'],
    ['携帯', 'ケータイ料金'],
    ['スマホ', 'ケータイ料金'],
    ['モバイル', 'ケータイ料金'],
    ['給与', TARGET_SALARY],
    ['給料', TARGET_SALARY],
    ['賞与', TARGET_SALARY],
  ]
  const incomeOnly = new Set(
    parsed.keys.filter((k) => parsed.txns.filter((t) => t.key === k).every((t) => t.expense === 0)),
  )
  const map: Record<string, string> = {}
  for (const key of parsed.keys) {
    if (saved[key]) {
      map[key] = saved[key]
      continue
    }
    const hint = hints.find(([sub, target]) => key.includes(sub) && (target === TARGET_SALARY || categories.includes(target)))
    map[key] = hint ? hint[1] : incomeOnly.has(key) ? TARGET_OTHER_INCOME : TARGET_IGNORE
  }
  return map
}

export interface MonthAgg {
  month: string
  salary: number | null
  other: number | null
  expenses: Record<string, number>
}

export function aggregate(txns: ZaimTxn[], mapping: Record<string, string>): MonthAgg[] {
  const byMonth = new Map<string, MonthAgg>()
  for (const t of txns) {
    const target = mapping[t.key] ?? TARGET_IGNORE
    if (target === TARGET_IGNORE) continue
    let agg = byMonth.get(t.month)
    if (!agg) {
      agg = { month: t.month, salary: null, other: null, expenses: {} }
      byMonth.set(t.month, agg)
    }
    if (target === TARGET_SALARY) {
      agg.salary = (agg.salary ?? 0) + t.income - t.expense
    } else if (target === TARGET_OTHER_INCOME) {
      agg.other = (agg.other ?? 0) + t.income - t.expense
    } else {
      agg.expenses[target] = (agg.expenses[target] ?? 0) + t.expense - t.income
    }
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}
