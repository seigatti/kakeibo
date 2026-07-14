import type { AssetRow, BonusConfig, ExpenseRow, FixedCostRow, FurusatoSalary, IncomeRow } from './types'

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

export interface SalaryEstimate {
  /** 月別の基準給与（1-12。未入力月は平均で補完） */
  monthlyGross: Array<{ month: number; gross: number; entered: boolean }>
  /** 月別のボーナス加算額（該当月のみ） */
  monthlyBonus: Array<{ month: number; amount: number; months: number | null; manual: boolean }>
  annualIncome: number // 年収想定 = 基準給与12ヶ月分 + ボーナス合計
  annualSocial: number // 社会保険料想定
  bonusTotal: number
  avgGross: number
  enteredMonths: number
  usedAvgAsBonusBase: boolean // 基準月額未入力で平均総支給を代用した
}

export function parseBonusConfig(json: string | null | undefined): BonusConfig {
  if (!json) return {}
  try {
    const v = JSON.parse(json) as BonusConfig
    return typeof v === 'object' && v !== null ? v : {}
  } catch {
    return {}
  }
}

/**
 * 月次給与から年収・社会保険料を推定する。
 * - 未入力月は「入力済み月と同様の収入」と想定（平均で補完）
 * - ボーナス = 手動金額（優先） or 基準月額×か月分（基準未入力なら平均総支給で代用）
 * - 社会保険料想定 = 平均月社保×12 + ボーナス合計×(平均月社保÷平均月総支給)（賞与分の概算）
 */
export function estimateSalary(entries: FurusatoSalary[], bonusBase: number | null, bonusConfig: BonusConfig): SalaryEstimate | null {
  const withGross = entries.filter((e) => e.gross !== null && e.gross > 0)
  if (withGross.length === 0) return null
  const avgGross = withGross.reduce((s, e) => s + (e.gross ?? 0), 0) / withGross.length

  const monthlyGross = Array.from({ length: 12 }, (_, i) => {
    const hit = withGross.find((e) => Number(e.month) === i + 1)
    return { month: i + 1, gross: hit?.gross ?? avgGross, entered: !!hit }
  })

  let usedAvgAsBonusBase = false
  const monthlyBonus: SalaryEstimate['monthlyBonus'] = []
  for (const [m, cfg] of Object.entries(bonusConfig)) {
    const month = Number(m)
    if (!(month >= 1 && month <= 12) || !cfg) continue
    if (cfg.amount) {
      monthlyBonus.push({ month, amount: cfg.amount, months: cfg.months ?? null, manual: true })
    } else if (cfg.months) {
      const base = bonusBase ?? avgGross
      if (bonusBase === null || bonusBase === undefined) usedAvgAsBonusBase = true
      monthlyBonus.push({ month, amount: base * cfg.months, months: cfg.months, manual: false })
    }
  }
  monthlyBonus.sort((a, b) => a.month - b.month)

  const bonusTotal = monthlyBonus.reduce((s, b) => s + b.amount, 0)
  const annualIncome = monthlyGross.reduce((s, g) => s + g.gross, 0) + bonusTotal

  const socialOf = (e: FurusatoSalary) => (e.health ?? 0) + (e.pension_ins ?? 0) + (e.employment ?? 0)
  const withSocial = entries.filter((e) => socialOf(e) > 0)
  let annualSocial = 0
  if (withSocial.length > 0) {
    const avgSocial = withSocial.reduce((s, e) => s + socialOf(e), 0) / withSocial.length
    annualSocial = avgSocial * 12 + (avgGross > 0 ? bonusTotal * (avgSocial / avgGross) : 0)
  }

  return {
    monthlyGross,
    monthlyBonus,
    annualIncome: Math.round(annualIncome),
    annualSocial: Math.round(annualSocial),
    bonusTotal: Math.round(bonusTotal),
    avgGross: Math.round(avgGross),
    enteredMonths: withGross.length,
    usedAvgAsBonusBase,
  }
}

/** 控除合計（=健保+厚年+雇用+所得税+住民税）。全項目未入力なら null */
export function deductionTotal(e: Partial<FurusatoSalary>): number | null {
  const vals = [e.health, e.pension_ins, e.employment, e.income_tax, e.resident_tax]
  if (vals.every((v) => v === null || v === undefined)) return null
  return vals.reduce<number>((s, v) => s + (v ?? 0), 0)
}

/** 記録のある月の全体範囲 */
export function dataMonthRange(expenses: ExpenseRow[], income: IncomeRow[]): string[] {
  const months = [...expenses.map((e) => e.month), ...income.map((i) => i.month)]
  if (months.length === 0) return []
  months.sort()
  return monthRange(months[0], months[months.length - 1])
}
