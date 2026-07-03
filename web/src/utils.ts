import type { AssetRow, ExpenseRow, FixedCostRow, IncomeRow } from './types'

export const yen = (v: number | null | undefined) =>
  v === null || v === undefined ? '−' : `${Math.round(v).toLocaleString('ja-JP')}円`

export const yenShort = (v: number) =>
  Math.abs(v) >= 10000 ? `${(v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}万` : `${v.toLocaleString('ja-JP')}`

export const thisMonth = () => new Date().toISOString().slice(0, 7)
export const today = () => new Date().toISOString().slice(0, 10)

/** YYYY-MM を n ヶ月ずらす */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** from〜to の月リスト（両端含む） */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from; m <= to && out.length < 600; m = addMonths(m, 1)) out.push(m)
  return out
}

/** 固定費の月割り額（月=そのまま、年=/12、2年=/24）。start/end範囲外は0 */
export function monthlyShare(fc: FixedCostRow, month?: string): number {
  if (month) {
    if (fc.start_month && month < fc.start_month) return 0
    if (fc.end_month && month > fc.end_month) return 0
  }
  const div = fc.frequency === '月' ? 1 : fc.frequency === '年' ? 12 : 24
  return fc.amount / div
}

export const fixedMonthlyTotal = (fixedCosts: FixedCostRow[], month?: string) =>
  fixedCosts.reduce((s, fc) => s + monthlyShare(fc, month), 0)

/** 資産合計（nullは0扱い） */
export const assetTotal = (a: AssetRow) => (a.investment ?? 0) + (a.cash ?? 0) + (a.pension ?? 0)

export const sortedAssets = (assets: AssetRow[]) => [...assets].sort((x, y) => x.date.localeCompare(y.date))

/** 月ごとの変動費合計 */
export function expenseByMonth(expenses: ExpenseRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of expenses) map.set(e.month, (map.get(e.month) ?? 0) + e.amount)
  return map
}

export function incomeByMonth(income: IncomeRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const i of income) map.set(i.month, (i.salary ?? 0) + (i.other ?? 0))
  return map
}

/** 記録のある月の全体範囲 */
export function dataMonthRange(expenses: ExpenseRow[], income: IncomeRow[]): string[] {
  const months = [...expenses.map((e) => e.month), ...income.map((i) => i.month)]
  if (months.length === 0) return []
  months.sort()
  return monthRange(months[0], months[months.length - 1])
}
