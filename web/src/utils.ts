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

/**
 * ふるさと納税の年間上限額（簡易計算・目安）
 * 総務省の標準式: 上限 = 住民税所得割 × 20% ÷ (90% − 所得税率 × 1.021) + 2000円
 * 給与収入のみ・独身/共働き（配偶者控除なし）を想定した概算。千円未満切り捨て。
 */
export function furusatoLimit(income: number | null, socialInsurance: number | null, medicalDeduction: number | null): number | null {
  if (!income || income <= 0) return null
  const social = socialInsurance ?? 0
  const medical = medicalDeduction ?? 0

  // 給与所得控除（令和2年〜）
  let salaryDeduction: number
  if (income <= 1_625_000) salaryDeduction = 550_000
  else if (income <= 1_800_000) salaryDeduction = income * 0.4 - 100_000
  else if (income <= 3_600_000) salaryDeduction = income * 0.3 + 80_000
  else if (income <= 6_600_000) salaryDeduction = income * 0.2 + 440_000
  else if (income <= 8_500_000) salaryDeduction = income * 0.1 + 1_100_000
  else salaryDeduction = 1_950_000

  const shotoku = income - salaryDeduction
  const taxableResident = Math.max(0, shotoku - social - medical - 430_000) // 住民税: 基礎控除43万
  const taxableIncomeTax = Math.max(0, shotoku - social - medical - 480_000) // 所得税: 基礎控除48万

  // 所得税率（復興特別所得税は式内の1.021で考慮）
  let rate: number
  if (taxableIncomeTax <= 1_950_000) rate = 0.05
  else if (taxableIncomeTax <= 3_300_000) rate = 0.1
  else if (taxableIncomeTax <= 6_950_000) rate = 0.2
  else if (taxableIncomeTax <= 9_000_000) rate = 0.23
  else if (taxableIncomeTax <= 18_000_000) rate = 0.33
  else if (taxableIncomeTax <= 40_000_000) rate = 0.4
  else rate = 0.45

  const residentTax = taxableResident * 0.1
  const limit = (residentTax * 0.2) / (0.9 - rate * 1.021) + 2000
  return Math.floor(limit / 1000) * 1000
}

/** 記録のある月の全体範囲 */
export function dataMonthRange(expenses: ExpenseRow[], income: IncomeRow[]): string[] {
  const months = [...expenses.map((e) => e.month), ...income.map((i) => i.month)]
  if (months.length === 0) return []
  months.sort()
  return monthRange(months[0], months[months.length - 1])
}
