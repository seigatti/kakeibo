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

export interface HomePlan {
  enabled: boolean
  buy_year: number
  price: number // 物件価格
  down_payment: number // 頭金
  loan_amount: number // 借入額
  interest_rate: number // %（住宅ローン金利・固定）
  loan_years: number // 返済年数
  current_rent_monthly: number // 現在の家賃（月額）。購入後は支出から控除
  renovation_annual: number // 修繕・維持費（年額・購入後ずっと）
  loan_deduction_years: number // 住宅ローン控除の年数（0=なし）
}

export const DEFAULT_HOME: HomePlan = {
  enabled: false,
  buy_year: new Date().getFullYear() + 3,
  price: 40_000_000,
  down_payment: 4_000_000,
  loan_amount: 36_000_000,
  interest_rate: 1.0,
  loan_years: 35,
  current_rent_monthly: 80_000,
  renovation_annual: 200_000,
  loan_deduction_years: 13,
}

export interface LifeplanConfig {
  inflation: number // %（実質インフレ率）
  invest_return: number // %（運用利回り。投資分にのみ複利で適用）
  raise_rate: number // %（昇給率）
  pension_growth: number // %（年金の上昇率。0=受給額は現在の額のまま。物価連動にするならインフレ率と同値）
  living_cost: number // 基本生活費（年額・現在価格・子供費用を除く）
  child_multiplier: number // 子供費用の倍率
  start_assets_override: number | null // 開始資産の手動上書き（空なら最新スナップショット）
  adults: LifeplanAdult[]
  children: LifeplanChild[]
  custom_flows: CustomFlow[]
  home: HomePlan
}

export const DEFAULT_LIFEPLAN: LifeplanConfig = {
  inflation: 2.0,
  invest_return: 3.0,
  raise_rate: 1.0,
  pension_growth: 0,
  living_cost: 3_000_000,
  child_multiplier: 1.0,
  start_assets_override: null,
  adults: [],
  children: [],
  custom_flows: [],
  home: DEFAULT_HOME,
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
      home: { ...DEFAULT_HOME, ...(v.home ?? {}) },
    }
  } catch {
    return DEFAULT_LIFEPLAN
  }
}

/** 住宅ローンの年間返済額（元利均等・固定金利）。rate=%/年、years=返済年数 */
export function annualLoanPayment(principal: number, ratePct: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0
  const r = ratePct / 100
  if (r === 0) return principal / years
  const monthly = principal * (r / 12) * Math.pow(1 + r / 12, years * 12) / (Math.pow(1 + r / 12, years * 12) - 1)
  return monthly * 12
}

/** ローン残高（返済n年経過後・元利均等） */
export function loanBalance(principal: number, ratePct: number, years: number, elapsed: number): number {
  if (elapsed <= 0) return principal
  if (elapsed >= years) return 0
  const r = ratePct / 100 / 12
  const n = years * 12
  const m = elapsed * 12
  if (r === 0) return principal * (1 - m / n)
  const bal = principal * (Math.pow(1 + r, n) - Math.pow(1 + r, m)) / (Math.pow(1 + r, n) - 1)
  return Math.max(0, bal)
}

/**
 * 子供1人の年間費用（現在価格・児童手当差引前）。
 * 目安の出典: 文部科学省「子供の学習費調査」等の概算（学費＋食費・衣類などの養育費込み）。
 * 高校は2026年度からの授業料無償化（所得制限なし・私立は就学支援金上限45.7万円）を反映済み。
 */
export function childAnnualCost(age: number, c: LifeplanChild): number {
  if (age < 0) return 0
  if (age <= 2) return 600_000 + (c.nursery ? 500_000 : 0) // 乳児期＋保育料（3歳〜は無償化前提）
  if (age <= 5) return 700_000
  if (age <= 11) return c.elementary === '私立' ? 2_200_000 : 900_000
  if (age <= 14) return c.junior === '私立' ? 2_050_000 : 1_150_000
  if (age <= 17) return c.high === '私立' ? 1_250_000 : 1_100_000 // 授業料無償化反映後
  if (c.path === '高卒') return 0
  const lastAge = c.path === '大学院' ? 23 : 21
  if (age <= lastAge) {
    return (c.college === '私立' ? 1_600_000 : 1_100_000) + (c.living === '一人暮らし' ? 1_200_000 : 400_000)
  }
  return 0
}

/**
 * 児童手当（2024年10月改正・2026年時点の現行制度）:
 * 3歳未満 月1.5万 / 3歳〜18歳年度末 月1万 / 第3子以降 月3万（所得制限なし）。
 * 第3子の数え方 = 22歳年度末までの子を年齢の高い順に数えて3番目以降。
 * @returns cfg.children と同じ並びの、その年の児童手当（年額）
 */
export function childAllowanceByIndex(children: LifeplanChild[], year: number): number[] {
  const ranked = children
    .map((c, idx) => ({ idx, age: year - c.birth_year }))
    .filter((x) => x.age >= 0 && x.age <= 22)
    .sort((a, b) => b.age - a.age)
  const out = children.map(() => 0)
  ranked.forEach((x, rank) => {
    if (x.age > 18) return // カウントには入るが支給は18歳年度末まで
    out[x.idx] = rank >= 2 ? 360_000 : x.age <= 2 ? 180_000 : 120_000
  })
  return out
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

/** 老齢基礎年金の満額（2026年度=令和8年度: 847,300円/年） */
export const BASIC_PENSION_FULL = 847_300

/**
 * 年金の年額を想定（簡易式）:
 * 老齢基礎年金 847,300円(2026年度満額) × min(加入年数,40)/40 + 老齢厚生年金 ≒ 平均年収(額面) × 0.5481% × 加入年数
 * 加入年数 = min(退職年齢, 65) − 22
 */
export function estimatePension(grossAnnual: number | null, retireAge: number): number {
  const years = Math.max(0, Math.min(retireAge, 65) - 22)
  const basic = BASIC_PENSION_FULL * (Math.min(years, 40) / 40)
  const kosei = (grossAnnual ?? 0) * 0.005481 * years
  return Math.round(basic + kosei)
}

export interface LifeplanRow {
  i: number // 経過年
  year: number
  ages: Array<{ name: string; age: number | null }>
  salary: number // 名目の給与収入
  pension: number // 名目の年金収入
  income: number // 名目の年収入（給与+年金+カスタム収入）
  living: number // 名目の基本生活費
  childCost: number // 名目の子供費用
  custom: number // 名目のカスタム収支（純額）
  home: number // 名目の住宅関連の純収支（控除−頭金−返済−修繕+家賃控除）
  expense: number // 名目の年支出
  assetsInvest: number // 投資分（運用利回りが効く）
  assetsNominal: number // 資産合計（投資分＋現金分）
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
  startInvest: number,
  startLiquid: number,
  startYear: number,
  resolvedNet: Record<string, number>,
  resolvedPension?: Record<string, number>,
): LifeplanResult {
  const rows: LifeplanRow[] = []
  let invest = startInvest // 運用利回りが効く投資分
  let liquid = startLiquid // 現金・年金（利回りは効かず、収支の黒字が積み上がる）
  let depletionYear: number | null = null

  for (let i = 0; i <= 80; i++) {
    const year = startYear + i
    const infl = Math.pow(1 + cfg.inflation / 100, i)
    const raise = Math.pow(1 + cfg.raise_rate / 100, i)
    const pensionGrow = Math.pow(1 + (cfg.pension_growth ?? 0) / 100, i)

    let salary = 0
    let pension = 0
    const ages: LifeplanRow['ages'] = []
    for (const a of cfg.adults) {
      const age = a.birth_year ? year - a.birth_year : null
      ages.push({ name: a.name, age })
      if (age === null) continue
      if (a.income_enabled && age < a.retire_age) salary += (resolvedNet[a.name] ?? 0) * raise
      const pensionAmount = resolvedPension?.[a.name] ?? a.pension ?? 0
      if (pensionAmount > 0 && age >= a.pension_start) pension += pensionAmount * pensionGrow
    }

    // 子供費用（倍率適用後）から児童手当を差し引いた純額
    const allowances = childAllowanceByIndex(cfg.children, year)
    let childCost = 0
    cfg.children.forEach((c, idx) => {
      childCost += childAnnualCost(year - c.birth_year, c) * cfg.child_multiplier - allowances[idx]
    })

    let customIn = 0
    let customOut = 0
    for (const f of cfg.custom_flows) {
      if (f.start_year <= year && year <= f.end_year) {
        if (f.annual >= 0) customIn += f.annual
        else customOut += -f.annual
      }
    }

    // マイホーム（現在価格。インフレは掛けない＝購入時点の実額として扱う）
    let homeNet = 0 // プラス=収入方向（家賃控除・ローン控除）、マイナス=支出
    const h = cfg.home
    if (h?.enabled) {
      if (year === h.buy_year) homeNet -= h.down_payment + h.price * 0.07 // 頭金＋諸費用（約7%）
      const elapsed = year - h.buy_year
      if (elapsed >= 0 && elapsed < h.loan_years) homeNet -= annualLoanPayment(h.loan_amount, h.interest_rate, h.loan_years)
      if (elapsed >= 0) {
        homeNet -= h.renovation_annual // 修繕・維持費
        homeNet += h.current_rent_monthly * 12 // 購入で家賃が消える＝支出減
      }
      if (elapsed >= 0 && elapsed < h.loan_deduction_years) {
        homeNet += Math.min(loanBalance(h.loan_amount, h.interest_rate, h.loan_years, elapsed) * 0.007, 300_000) // 住宅ローン控除（残高0.7%・上限内・簡易）
      }
    }

    const living = cfg.living_cost * infl
    const childNominal = childCost * infl
    const expense = living + childNominal + customOut * infl - Math.min(homeNet, 0) // 住宅の支出分
    const income = salary + pension + customIn * infl + Math.max(homeNet, 0) // 住宅の収入分（家賃控除・ローン控除）

    // 投資分は運用利回りで複利成長。年間収支の黒字/赤字は現金（liquid）で調整
    invest *= 1 + cfg.invest_return / 100
    liquid += income - expense
    const assets = invest + liquid
    if (assets < 0 && depletionYear === null) depletionYear = year

    rows.push({
      i, year, ages,
      salary: Math.round(salary),
      pension: Math.round(pension),
      income: Math.round(income),
      living: Math.round(living),
      childCost: Math.round(childNominal),
      custom: Math.round((customIn - customOut) * infl),
      home: Math.round(homeNet),
      expense: Math.round(expense),
      assetsInvest: Math.round(invest),
      assetsNominal: Math.round(assets),
      assetsReal: Math.round(assets / infl),
    })
  }
  return { rows, depletionYear }
}
