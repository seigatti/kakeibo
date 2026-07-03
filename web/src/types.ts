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

export interface AllData {
  assets: AssetRow[]
  expenses: ExpenseRow[]
  fixed_costs: FixedCostRow[]
  income: IncomeRow[]
  zaim_net: ZaimNetRow[]
  settings: SettingRow[]
}

export const DEFAULT_CATEGORIES = ['ガス代', '電気代', '上下水道', 'ガソリン代', '高速料金', 'ケータイ料金']
