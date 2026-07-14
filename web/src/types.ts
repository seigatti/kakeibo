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

export type FurusatoPerson = 'せ' | 'あ'

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
}

export const APPLICATION_STATUSES = ['未購入', '購入済み、書類未', 'ワンストップ未', '手続き済、税額確認未', '完了'] as const
export const APPLICATION_METHODS = ['自治体マイページ', 'ふるまど（IAM）', '確定申告', '郵送'] as const

export interface AllData {
  assets: AssetRow[]
  expenses: ExpenseRow[]
  fixed_costs: FixedCostRow[]
  income: IncomeRow[]
  zaim_net: ZaimNetRow[]
  // 古いGASデプロイでは返ってこないため optional（フロントは ?? [] で扱う）
  furusato_items?: FurusatoItem[]
  furusato_years?: FurusatoYear[]
  settings: SettingRow[]
}

export const DEFAULT_CATEGORIES = ['ガス代', '電気代', '上下水道', 'ガソリン代', '高速料金', 'ケータイ料金']
