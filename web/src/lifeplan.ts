/**
 * ライフプラン・シミュレーション（純関数）
 * 今年を0年目として80年後までの世帯資産推移を計算する。
 * - 支出（生活費・子供費用・カスタム支出）は現在価格で持ち、毎年インフレ率分増える
 * - 実質資産 = 名目資産 ÷ (1+インフレ)^経過年（今の価値に換算）
 * - 年金は物価連動と仮定してインフレで増額、給与は昇給率で増額
 */
import type { BonusConfig, FurusatoSalary } from './types.ts'
import { deductionTotal, estimateSalary, type SalaryEstimate } from './utils.ts'

export interface LifeplanAdult {
  name: string
  birth_year: number | null
  net_income: number | null // 手取り年収（手動・優先。空なら給与データから想定）
  income_enabled: boolean // 収入を世帯合算に含めるか
  retire_age: number
  pension: number | null // 年金（年額・現在価格）
  pension_start: number
}

export type SchoolType = '公立' | '私立'
export type ChildPath = '高卒' | '大卒' | '大学院'
export type CollegeType = '国公立' | '私立'
export type LivingType = '実家' | '一人暮らし'

export interface LifeplanChild {
  birth_year: number
  nursery: boolean // 0〜2歳の保育園
  elementary: SchoolType
  junior: SchoolType
  high: SchoolType
  path: ChildPath
  college: CollegeType
  living: LivingType
}

export interface CustomFlow {
  label: string
  start_year: number
  end_year: number
  annual: number // 年額（現在価格）。マイナス=支出、プラス=収入
}

export interface LifeplanConfig {
  inflation: number // %（実質インフレ率）
  invest_return: number // %（運用利回り）
  raise_rate: number // %（昇給率）
  living_cost: number // 基本生活費（年額・現在価格・子供費用を除く）
  child_multiplier: number // 子供費用の倍率
  start_assets_override: number | null // 開始資産の手動上書き（空なら最新スナップショット）
  adults: LifeplanAdult[]
  children: LifeplanChild[]
  custom_flows: CustomFlow[]
}

export const DEFAULT_LIFEPLAN: LifeplanConfig = {
  inflation: 2.0,
  invest_return: 3.0,
  raise_rate: 1.0,
  living_cost: 3_000_000,
  child_multiplier: 1.0,
  start_assets_override: null,
  adults: [],
  children: [],
  custom_flows: [],
}

export function parseLifeplan(json: string | null | undefined): LifeplanConfig {
  if (!json) return DEFAULT_LIFEPLAN
  try {
    const v = JSON.parse(json) as Partial<LifeplanConfig>
    return {
      ...DEFAULT_LIFEPLAN,
      ...v,
      adults: Array.isArray(v.adults) ? v.adults : [],
      children: Array.isArray(v.children) ? v.children : [],
      custom_flows: Array.isArray(v.custom_flows) ? v.custom_flows : [],
    }
  } catch {
    return DEFAULT_LIFEPLAN
  }
}

/**
 * 子供1人の年間費用（現在価格）。
 * 目安の出典: 文部科学省「子供の学習費調査」等の概算（学費＋食費・衣類などの養育費込み）
 */
export function childAnnualCost(age: number, c: LifeplanChild): number {
  if (age < 0) return 0
  if (age <= 2) return 600_000 + (c.nursery ? 500_000 : 0) // 乳児期＋保育料（3歳〜は無償化前提）
  if (age <= 5) return 700_000
  if (age <= 11) return c.elementary === '私立' ? 2_200_000 : 900_000
  if (age <= 14) return c.junior === '私立' ? 2_050_000 : 1_150_000
  if (age <= 17) return c.high === '私立' ? 1_700_000 : 1_160_000
  if (c.path === '高卒') return 0
  const lastAge = c.path === '大学院' ? 23 : 21
  if (age <= lastAge) {
    return (c.college === '私立' ? 1_600_000 : 1_100_000) + (c.living === '一人暮らし' ? 1_200_000 : 400_000)
  }
  return 0
}

/** 給与データから年収を想定。net=手取り（手取り月平均×12 + ボーナス×手取り率）、gross=額面 */
export function estimateIncome(
  entries: FurusatoSalary[],
  bonusBase: number | null,
  bonusConfig: BonusConfig,
): { net: number; gross: number } | null {
  const est: SalaryEstimate | null = estimateSalary(entries, bonusBase, bonusConfig)
  if (!est) return null
  const withGross = entries.filter((e) => e.gross !== null && e.gross > 0)
  const nets = withGross.map((e) => (e.gross ?? 0) - (deductionTotal(e) ?? 0))
  const netAvg = nets.reduce((s, v) => s + v, 0) / nets.length
  const annualNet = netAvg * 12 + est.bonusTotal * (est.avgGross > 0 ? netAvg / est.avgGross : 1)
  return { net: Math.round(annualNet), gross: est.annualIncome }
}

/** 旧シグネチャ互換 */
export function estimateNetIncome(entries: FurusatoSalary[], bonusBase: number | null, bonusConfig: BonusConfig): number | null {
  return estimateIncome(entries, bonusBase, bonusConfig)?.net ?? null
}

/**
 * 年金の年額を想定（簡易式）:
 * 老齢基礎年金 816,000円 × min(加入年数,40)/40 + 老齢厚生年金 ≒ 平均年収(額面) × 0.5481% × 加入年数
 * 加入年数 = min(退職年齢, 65) − 22
 */
export function estimatePension(grossAnnual: number | null, retireAge: number): number {
  const years = Math.max(0, Math.min(retireAge, 65) - 22)
  const basic = 816_000 * (Math.min(years, 40) / 40)
  const kosei = (grossAnnual ?? 0) * 0.005481 * years
  return Math.round(basic + kosei)
}

export interface LifeplanRow {
  i: number // 経過年
  year: number
  ages: Array<{ name: string; age: number | null }>
  income: number // 名目の年収入（給与+年金+カスタム収入）
  living: number // 名目の基本生活費
  childCost: number // 名目の子供費用
  custom: number // 名目のカスタム収支（純額）
  expense: number // 名目の年支出
  assetsNominal: number
  assetsReal: number
}

export interface LifeplanResult {
  rows: LifeplanRow[]
  depletionYear: number | null // 資産が初めてマイナスになる年（なければnull）
}

/**
 * @param resolvedNet 大人ごとの採用手取り年収（手動 or 給与データからの想定を呼び出し側で解決済み）
 * @param resolvedPension 大人ごとの採用年金額（手動 or 想定。省略時は cfg の手入力値のみ使用）
 */
export function simulate(
  cfg: LifeplanConfig,
  startAssets: number,
  startYear: number,
  resolvedNet: Record<string, number>,
  resolvedPension?: Record<string, number>,
): LifeplanResult {
  const rows: LifeplanRow[] = []
  let assets = startAssets
  let depletionYear: number | null = null

  for (let i = 0; i <= 80; i++) {
    const year = startYear + i
    const infl = Math.pow(1 + cfg.inflation / 100, i)
    const raise = Math.pow(1 + cfg.raise_rate / 100, i)

    let salary = 0
    let pension = 0
    const ages: LifeplanRow['ages'] = []
    for (const a of cfg.adults) {
      const age = a.birth_year ? year - a.birth_year : null
      ages.push({ name: a.name, age })
      if (age === null) continue
      if (a.income_enabled && age < a.retire_age) salary += (resolvedNet[a.name] ?? 0) * raise
      const pensionAmount = resolvedPension?.[a.name] ?? a.pension ?? 0
      if (pensionAmount > 0 && age >= a.pension_start) pension += pensionAmount * infl
    }

    let childCost = 0
    for (const c of cfg.children) {
      childCost += childAnnualCost(year - c.birth_year, c) * cfg.child_multiplier
    }

    let customIn = 0
    let customOut = 0
    for (const f of cfg.custom_flows) {
      if (f.start_year <= year && year <= f.end_year) {
        if (f.annual >= 0) customIn += f.annual
        else customOut += -f.annual
      }
    }

    const living = cfg.living_cost * infl
    const childNominal = childCost * infl
    const expense = living + childNominal + customOut * infl
    const income = salary + pension + customIn * infl

    // 年初資産に運用益、その年の収支を反映して年末資産へ
    assets = assets * (1 + cfg.invest_return / 100) + income - expense
    if (assets < 0 && depletionYear === null) depletionYear = year

    rows.push({
      i, year, ages,
      income: Math.round(income),
      living: Math.round(living),
      childCost: Math.round(childNominal),
      custom: Math.round((customIn - customOut) * infl),
      expense: Math.round(expense),
      assetsNominal: Math.round(assets),
      assetsReal: Math.round(assets / infl),
    })
  }
  return { rows, depletionYear }
}
