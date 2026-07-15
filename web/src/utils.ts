import type { AssetRow, BonusConfig, ExpenseRow, FixedCostRow, FurusatoProfile, FurusatoSalary, IncomeRow } from './types'

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

/** ふるさとの月次給与から月ごとの世帯手取り（総支給−控除合計。全員分合算） */
export function netSalaryByMonth(salaries: FurusatoSalary[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const s of salaries) {
    if (!s.gross || s.gross <= 0) continue
    const key = `${s.year}-${String(s.month).padStart(2, '0')}`
    const net = s.gross - (deductionTotal(s) ?? 0)
    map.set(key, (map.get(key) ?? 0) + net)
  }
  return map
}

/**
 * 月ごとの実効収入。給料は手入力（income.salary）を優先し、
 * 未入力の月は ふるさとの給与データの手取りを自動採用する。その他収入は常に加算。
 */
export function effectiveIncomeByMonth(income: IncomeRow[], salaries: FurusatoSalary[]): Map<string, number> {
  const net = netSalaryByMonth(salaries)
  const map = new Map<string, number>()
  const months = new Set([...income.map((i) => i.month), ...net.keys()])
  for (const m of months) {
    const row = income.find((i) => i.month === m)
    const salary = row?.salary ?? net.get(m) ?? 0
    map.set(m, salary + (row?.other ?? 0))
  }
  return map
}

// ================================================================ ふるさと納税 上限計算

/** 給与所得控除（令和2年〜） */
export function salaryIncomeDeduction(income: number): number {
  if (income <= 1_625_000) return 550_000
  if (income <= 1_800_000) return income * 0.4 - 100_000
  if (income <= 3_600_000) return income * 0.3 + 80_000
  if (income <= 6_600_000) return income * 0.2 + 440_000
  if (income <= 8_500_000) return income * 0.1 + 1_100_000
  return 1_950_000
}

/** 所得税の速算表（復興特別所得税を除く本税）。rate はふるさと特例式にも使用 */
export function incomeTaxOf(taxable: number): { tax: number; rate: number } {
  const t = Math.max(0, taxable)
  if (t <= 1_950_000) return { tax: t * 0.05, rate: 0.05 }
  if (t <= 3_300_000) return { tax: t * 0.1 - 97_500, rate: 0.1 }
  if (t <= 6_950_000) return { tax: t * 0.2 - 427_500, rate: 0.2 }
  if (t <= 9_000_000) return { tax: t * 0.23 - 636_000, rate: 0.23 }
  if (t <= 18_000_000) return { tax: t * 0.33 - 1_536_000, rate: 0.33 }
  if (t <= 40_000_000) return { tax: t * 0.4 - 2_796_000, rate: 0.4 }
  return { tax: t * 0.45 - 4_796_000, rate: 0.45 }
}

/** 生命保険料控除（新制度・一般生命保険のみの簡易計算）: 所得税側(it)/住民税側(rt) */
export function lifeInsuranceDeduction(paid: number): { it: number; rt: number } {
  const it = paid <= 20_000 ? paid : paid <= 40_000 ? paid / 2 + 10_000 : paid <= 80_000 ? paid / 4 + 20_000 : 40_000
  const rt = paid <= 12_000 ? paid : paid <= 32_000 ? paid / 2 + 6_000 : paid <= 56_000 ? paid / 4 + 14_000 : 28_000
  return { it, rt }
}

/** 地震保険料控除: 所得税側 min(支払, 5万) / 住民税側 min(支払/2, 2.5万) */
export function quakeInsuranceDeduction(paid: number): { it: number; rt: number } {
  return { it: Math.min(paid, 50_000), rt: Math.min(paid / 2, 25_000) }
}

/** 扶養控除（対象年12/31時点の年齢で判定） */
export function dependentDeduction(age: number): { it: number; rt: number; label: string } {
  if (age < 16) return { it: 0, rt: 0, label: '対象外(16歳未満)' }
  if (age <= 18) return { it: 380_000, rt: 330_000, label: '一般' }
  if (age <= 22) return { it: 630_000, rt: 450_000, label: '特定' }
  if (age < 70) return { it: 380_000, rt: 330_000, label: '一般' }
  return { it: 480_000, rt: 380_000, label: '老人' }
}

export interface FurusatoLimitInputs {
  income: number | null // 年収（給与）
  social: number | null // 社会保険料（年額）
  lifePaid?: number | null // 生命保険料 支払額
  quakePaid?: number | null // 地震保険料 支払額
  medicalPaid?: number | null // 医療費 支払額
  medicalDeductionOverride?: number | null // 医療費控除額の直接指定（支払額より優先）
  spouse?: boolean // 配偶者控除（世帯主のみ）
  dependentAges?: number[] // 扶養家族の年齢（世帯主のみ）
  loanAnnualDeduction?: number | null // 住宅ローン控除の年間控除額（世帯主のみ）
}

export interface FurusatoLimitBreakdown {
  salaryDeduction: number
  shotoku: number
  social: number
  life: { it: number; rt: number }
  quake: { it: number; rt: number }
  medical: number
  spouse: { it: number; rt: number }
  dependents: Array<{ age: number; label: string; it: number; rt: number }>
  taxableIT: number
  taxableRT: number
  incomeTax: number
  rate: number
  residentTax: number
  loanResident: number
  residentTaxAfterLoan: number
}

/**
 * ふるさと納税の年間上限額（詳細版・目安）
 * 総務省の標準式: 上限 = 住民税所得割 × 20% ÷ (90% − 所得税率 × 1.021) + 2000円
 * 簡易化: 生命保険料控除は新制度・一般区分のみ / 配偶者特別控除・老人同居加算・調整控除は省略。千円未満切り捨て。
 */
export function furusatoLimitDetailed(inp: FurusatoLimitInputs): { limit: number; breakdown: FurusatoLimitBreakdown } | null {
  if (!inp.income || inp.income <= 0) return null
  const social = inp.social ?? 0
  const salaryDeduction = salaryIncomeDeduction(inp.income)
  const shotoku = inp.income - salaryDeduction

  const life = inp.lifePaid ? lifeInsuranceDeduction(inp.lifePaid) : { it: 0, rt: 0 }
  const quake = inp.quakePaid ? quakeInsuranceDeduction(inp.quakePaid) : { it: 0, rt: 0 }
  const medical =
    inp.medicalDeductionOverride ??
    (inp.medicalPaid ? Math.max(0, inp.medicalPaid - Math.min(100_000, shotoku * 0.05)) : 0)
  const spouse = inp.spouse ? { it: 380_000, rt: 330_000 } : { it: 0, rt: 0 }
  const dependents = (inp.dependentAges ?? []).map((age) => ({ age, ...dependentDeduction(age) }))
  const depIT = dependents.reduce((s, d) => s + d.it, 0)
  const depRT = dependents.reduce((s, d) => s + d.rt, 0)

  const taxableIT = Math.max(0, shotoku - social - life.it - quake.it - medical - spouse.it - depIT - 480_000)
  const taxableRT = Math.max(0, shotoku - social - life.rt - quake.rt - medical - spouse.rt - depRT - 430_000)

  const { tax: incomeTax, rate } = incomeTaxOf(taxableIT)
  const residentTax = taxableRT * 0.1

  // 住宅ローン控除: 所得税から引き切れない分が住民税から控除（上限 課税所得×7% / 136,500円）→ 所得割が減り上限も下がる
  const loanResident = inp.loanAnnualDeduction
    ? Math.min(Math.max(0, inp.loanAnnualDeduction - incomeTax), Math.min(taxableIT * 0.07, 136_500))
    : 0
  const residentTaxAfterLoan = Math.max(0, residentTax - loanResident)

  const limit = Math.floor(((residentTaxAfterLoan * 0.2) / (0.9 - rate * 1.021) + 2000) / 1000) * 1000
  return {
    limit,
    breakdown: {
      salaryDeduction, shotoku, social, life, quake, medical, spouse, dependents,
      taxableIT, taxableRT, incomeTax, rate, residentTax, loanResident, residentTaxAfterLoan,
    },
  }
}

/** 旧シグネチャ互換（年収・社保・医療費控除のみの簡易版） */
export function furusatoLimit(income: number | null, socialInsurance: number | null, medicalDeduction: number | null): number | null {
  return furusatoLimitDetailed({ income, social: socialInsurance, medicalDeductionOverride: medicalDeduction ?? 0 })?.limit ?? null
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

export const EMPTY_PROFILE: FurusatoProfile = {
  head_person: null,
  spouse: false,
  dependents: [],
  housing_loan: { enabled: false, annual_deduction: null },
}

export function parseProfile(json: string | null | undefined): FurusatoProfile {
  if (!json) return EMPTY_PROFILE
  try {
    const v = JSON.parse(json) as Partial<FurusatoProfile>
    return {
      head_person: v.head_person ?? null,
      spouse: !!v.spouse,
      dependents: Array.isArray(v.dependents) ? v.dependents.filter((d) => d && typeof d.birth_year === 'number') : [],
      housing_loan: {
        enabled: !!v.housing_loan?.enabled,
        annual_deduction: v.housing_loan?.annual_deduction ?? null,
      },
    }
  } catch {
    return EMPTY_PROFILE
  }
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
export function dataMonthRange(expenses: ExpenseRow[], income: IncomeRow[], extraMonths: string[] = []): string[] {
  const months = [...expenses.map((e) => e.month), ...income.map((i) => i.month), ...extraMonths]
  if (months.length === 0) return []
  months.sort()
  return monthRange(months[0], months[months.length - 1])
}
