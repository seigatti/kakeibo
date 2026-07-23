export interface AssetRow {
  date: string // YYYY-MM-DD
  investment: number | null
  cash: number | null
  pension: number | null
  mf_profit: number | null // マネフォの評価損益（累計）
  memo: string | null
}

export interface ExpenseRow {
  month: string // YYYY-MM
  category: string
  amount: number
}

export type Frequency = '月' | '年' | '2年'

export interface FixedCostRow {
  id: string
  name: string
  amount: number
  frequency: Frequency
  start_month: string | null
  end_month: string | null
  memo: string | null
}

export interface IncomeRow {
  month: string // YYYY-MM
  salary: number | null
  other: number | null
  memo: string | null
}

export interface ZaimNetRow {
  month: string
  amount: number
}

export interface SettingRow {
  key: string
  value: string
}

export type FurusatoPerson = string // 管理者名（settings の furusato_persons で管理、既定は「せ,あ」）

export const DEFAULT_PERSONS = ['夫', '妻']

/** ボーナス設定: 月番号(1-12の文字列) → か月分/金額（金額があれば優先） */
export type BonusConfig = Record<string, { months?: number | null; amount?: number | null }>

export interface FurusatoItem {
  id: string
  person: FurusatoPerson
  year: number | null // 未購入候補は年なし
  name: string
  price: number | null
  municipality: string | null
  url: string | null
  application_status: string | null
  application_method: string | null
  receipt_status: string | null
  memo: string | null
}

export interface FurusatoYear {
  person: FurusatoPerson
  year: number
  income: number | null // 年収（税額通知書 or 想定）
  social_insurance: number | null
  medical_deduction: number | null
  limit_manual: number | null // 手動上限（入力があれば計算値より優先）
  memo: string | null
  bonus_base: number | null // ボーナス基準月額
  bonus_config: string | null // BonusConfig の JSON文字列
  life_paid: number | null // 生命保険料の年間支払額
  quake_paid: number | null // 地震保険料の年間支払額
  medical_paid: number | null // 医療費の年間支払額
}

/** 世帯で1つの控除プロフィール（settings の furusato_profile にJSON保存） */
export interface FurusatoProfile {
  head_person: string | null // 世帯主。家族系控除（配偶者・扶養・住宅ローン）はこの管理者にのみ適用
  spouse: boolean // 配偶者控除
  dependents: Array<{ birth_year: number }> // 扶養家族（生年で持ち、対象年ごとに区分を自動判定）
  housing_loan: { enabled: boolean; annual_deduction: number | null }
}

export interface FurusatoSalary {
  person: FurusatoPerson
  year: number
  month: number // 1-12
  gross: number | null // 総支給額
  health: number | null // 健康保険
  pension_ins: number | null // 厚生年金保険
  employment: number | null // 雇用保険
  care_ins: number | null // 介護保険（40歳以降）
  income_tax: number | null // 所得税
  resident_tax: number | null // 住民税
}

export const APPLICATION_STATUSES = ['未購入', '購入済み、書類未', 'ワンストップ未', '手続き済、税額確認未', '完了'] as const
export const APPLICATION_METHODS = ['自治体マイページ', 'ふるまど（IAM）', '確定申告', '郵送'] as const

export interface MemoRow {
  id: string
  text: string
  updated_at: string | null
}

export type LiabilityKind = 'ローン' | 'その他'

export interface LiabilityRow {
  id: string
  name: string
  kind: LiabilityKind
  principal: number | null // 当初借入額（ローン）
  start_month: string | null // 返済開始月 YYYY-MM（ローン）
  rate: number | null // 金利 %（ローン）
  years: number | null // 返済年数（ローン）
  balance_manual: number | null // 現在残高の実測（あれば現在時点はこれを優先。「その他」は必須）
  memo: string | null
}

export const LIABILITY_KINDS: LiabilityKind[] = ['ローン', 'その他']

export interface AllData {
  assets: AssetRow[]
  expenses: ExpenseRow[]
  fixed_costs: FixedCostRow[]
  income: IncomeRow[]
  zaim_net: ZaimNetRow[]
  // 古いGASデプロイでは返ってこないため optional（フロントは ?? [] で扱う）
  furusato_items?: FurusatoItem[]
  furusato_years?: FurusatoYear[]
  furusato_salaries?: FurusatoSalary[]
  memos?: MemoRow[]
  liabilities?: LiabilityRow[]
  settings: SettingRow[]
}

export const DEFAULT_CATEGORIES = ['ガス代', '電気代', '上下水道', 'ガソリン代', '高速料金', 'ケータイ料金']
