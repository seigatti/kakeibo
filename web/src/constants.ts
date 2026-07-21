/**
 * 計算の基準値（定数）レジストリ。
 * ふるさと納税の上限計算やライフプランの試算に使う「制度に基づく数値」や「想定値」を
 * 一元管理し、設定画面から編集できるようにする。
 *
 * 使い方: 計算コードは数値リテラルの代わりに getConst('key') を呼ぶ。
 * オーバーライドは settings シートの constants_override(JSON) に保存し、
 * App 起動時に setConstantOverrides() で反映する（masked と同じモジュール変数パターン）。
 */

export type ConstUnit = '円' | '%' | '歳' | '倍'
export type ConstGroup = '年金（想定）' | '子供費用' | '児童手当' | 'マイホーム' | '税制・ふるさと納税'

export interface ConstDef {
  key: string
  group: ConstGroup
  label: string
  unit: ConstUnit
  default: number
  source: { label: string; url: string }
  /** この既定値が反映している年度（制度改正で変わりうる値の鮮度管理に使用） */
  reviewYear: number
  /** true の定数は毎年〜数年で改定されうる（要確認バッジの対象） */
  annual: boolean
  note?: string
}

const SRC = {
  pension: { label: '日本年金機構「令和8年度の年金額」', url: 'https://www.nenkin.go.jp/oshirase/taisetu/kojin/2026/202604/0401.html' },
  gakushu: { label: '文部科学省「子供の学習費調査」', url: 'https://www.mext.go.jp/b_menu/toukei/chousa03/gakushuuhi/1268091.htm' },
  jidouteate: { label: 'こども家庭庁「児童手当制度のご案内」', url: 'https://www.cfa.go.jp/policies/kokoseido/jidouteate/annai' },
  furusato: { label: '総務省「ふるさと納税ポータル」', url: 'https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/furusato/' },
  nta_kojo: { label: '国税庁「所得控除のあらまし」', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/shoto320.htm' },
  nta_loan: { label: '国税庁「住宅借入金等特別控除」', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1213.htm' },
  nta_medical: { label: '国税庁「医療費控除」', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1120.htm' },
  home: { label: '（目安）住宅購入の諸費用・維持費の一般的水準', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1213.htm' },
} as const

export const CONSTANTS: ConstDef[] = [
  // ---- 年金（想定） ----
  { key: 'pension_full', group: '年金（想定）', label: '老齢基礎年金 満額（年額）', unit: '円', default: 847_300, source: SRC.pension, reviewYear: 2026, annual: true },
  { key: 'pension_kosei_rate', group: '年金（想定）', label: '厚生年金の概算係数（年収×係数×加入年数）', unit: '%', default: 0.5481, source: SRC.pension, reviewYear: 2026, annual: false, note: '報酬比例部分のごく簡易な概算係数' },
  { key: 'pension_join_start_age', group: '年金（想定）', label: '厚生年金 加入開始年齢', unit: '歳', default: 22, source: SRC.pension, reviewYear: 2026, annual: false },
  { key: 'pension_join_end_age', group: '年金（想定）', label: '厚生年金 加入上限年齢', unit: '歳', default: 65, source: SRC.pension, reviewYear: 2026, annual: false },
  { key: 'net_to_gross', group: '年金（想定）', label: '手取り→額面 換算率（手取り÷この値＝額面）', unit: '倍', default: 0.78, source: SRC.pension, reviewYear: 2026, annual: false },

  // ---- 子供費用（現在価格・年額・1人あたり） ----
  { key: 'child_infant', group: '子供費用', label: '0〜2歳 基本（年額）', unit: '円', default: 600_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_nursery', group: '子供費用', label: '0〜2歳 保育料の加算（保育園あり）', unit: '円', default: 500_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_preschool', group: '子供費用', label: '3〜5歳（幼保無償化前提）', unit: '円', default: 700_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_elem_public', group: '子供費用', label: '小学校 公立（年額）', unit: '円', default: 900_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_elem_private', group: '子供費用', label: '小学校 私立（年額）', unit: '円', default: 2_200_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_junior_public', group: '子供費用', label: '中学校 公立（年額）', unit: '円', default: 1_150_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_junior_private', group: '子供費用', label: '中学校 私立（年額）', unit: '円', default: 2_050_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_high_public', group: '子供費用', label: '高校 公立（年額・無償化反映）', unit: '円', default: 1_100_000, source: SRC.gakushu, reviewYear: 2026, annual: true },
  { key: 'child_high_private', group: '子供費用', label: '高校 私立（年額・無償化反映）', unit: '円', default: 1_250_000, source: SRC.gakushu, reviewYear: 2026, annual: true },
  { key: 'child_univ_public', group: '子供費用', label: '大学 国公立（年額・学費分）', unit: '円', default: 1_100_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_univ_private', group: '子供費用', label: '大学 私立（年額・学費分）', unit: '円', default: 1_600_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_live_alone', group: '子供費用', label: '大学 一人暮らしの生活費加算（年額）', unit: '円', default: 1_200_000, source: SRC.gakushu, reviewYear: 2026, annual: false },
  { key: 'child_live_home', group: '子供費用', label: '大学 実家通いの加算（年額）', unit: '円', default: 400_000, source: SRC.gakushu, reviewYear: 2026, annual: false },

  // ---- 児童手当 ----
  { key: 'allowance_0_2', group: '児童手当', label: '0〜2歳（年額・月1.5万×12）', unit: '円', default: 180_000, source: SRC.jidouteate, reviewYear: 2026, annual: true },
  { key: 'allowance_3_18', group: '児童手当', label: '3歳〜18歳年度末（年額・月1万×12）', unit: '円', default: 120_000, source: SRC.jidouteate, reviewYear: 2026, annual: true },
  { key: 'allowance_third', group: '児童手当', label: '第3子以降（年額・月3万×12）', unit: '円', default: 360_000, source: SRC.jidouteate, reviewYear: 2026, annual: true },

  // ---- マイホーム ----
  { key: 'home_fee_rate', group: 'マイホーム', label: '購入諸費用の率（物件価格×この率）', unit: '%', default: 7, source: SRC.home, reviewYear: 2026, annual: false },
  { key: 'home_loan_deduction_rate', group: 'マイホーム', label: '住宅ローン控除の率（年末残高×この率）', unit: '%', default: 0.7, source: SRC.nta_loan, reviewYear: 2026, annual: true },
  { key: 'home_loan_deduction_cap', group: 'マイホーム', label: '住宅ローン控除の年上限', unit: '円', default: 300_000, source: SRC.nta_loan, reviewYear: 2026, annual: true },

  // ---- 税制・ふるさと納税 ----
  { key: 'furusato_self_pay', group: '税制・ふるさと納税', label: 'ふるさと納税の自己負担額', unit: '円', default: 2_000, source: SRC.furusato, reviewYear: 2026, annual: false },
  { key: 'resident_tax_rate', group: '税制・ふるさと納税', label: '住民税 所得割の税率', unit: '%', default: 10, source: SRC.furusato, reviewYear: 2026, annual: false },
  { key: 'medical_floor', group: '税制・ふるさと納税', label: '医療費控除の足切り額（所得5%との小さい方）', unit: '円', default: 100_000, source: SRC.nta_medical, reviewYear: 2026, annual: false },
  { key: 'life_ins_cap_it', group: '税制・ふるさと納税', label: '生命保険料控除 上限（所得税）', unit: '円', default: 40_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'life_ins_cap_rt', group: '税制・ふるさと納税', label: '生命保険料控除 上限（住民税）', unit: '円', default: 28_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'quake_ins_cap_it', group: '税制・ふるさと納税', label: '地震保険料控除 上限（所得税）', unit: '円', default: 50_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'quake_ins_cap_rt', group: '税制・ふるさと納税', label: '地震保険料控除 上限（住民税）', unit: '円', default: 25_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'resident_basic_deduction', group: '税制・ふるさと納税', label: '住民税の基礎控除', unit: '円', default: 430_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'spouse_it', group: '税制・ふるさと納税', label: '配偶者控除（所得税）', unit: '円', default: 380_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'spouse_rt', group: '税制・ふるさと納税', label: '配偶者控除（住民税）', unit: '円', default: 330_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'dep_general_it', group: '税制・ふるさと納税', label: '扶養控除 一般（所得税）', unit: '円', default: 380_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'dep_general_rt', group: '税制・ふるさと納税', label: '扶養控除 一般（住民税）', unit: '円', default: 330_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'dep_specific_it', group: '税制・ふるさと納税', label: '扶養控除 特定19〜22歳（所得税）', unit: '円', default: 630_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'dep_specific_rt', group: '税制・ふるさと納税', label: '扶養控除 特定19〜22歳（住民税）', unit: '円', default: 450_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'dep_elderly_it', group: '税制・ふるさと納税', label: '扶養控除 老人70歳〜（所得税）', unit: '円', default: 480_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'dep_elderly_rt', group: '税制・ふるさと納税', label: '扶養控除 老人70歳〜（住民税）', unit: '円', default: 380_000, source: SRC.nta_kojo, reviewYear: 2026, annual: false },
  { key: 'loan_resident_cap', group: '税制・ふるさと納税', label: '住宅ローン控除の住民税上限', unit: '円', default: 136_500, source: SRC.nta_loan, reviewYear: 2026, annual: false },
]

const DEFAULTS: Record<string, number> = Object.fromEntries(CONSTANTS.map((c) => [c.key, c.default]))
const DEFS: Record<string, ConstDef> = Object.fromEntries(CONSTANTS.map((c) => [c.key, c]))

let overrides: Record<string, number> = {}

/** settings の constants_override(JSON文字列) を反映（App 起動時・保存後に呼ぶ） */
export function setConstantOverrides(json: string | null | undefined | Record<string, number>) {
  if (!json) {
    overrides = {}
    return
  }
  try {
    const obj = typeof json === 'string' ? (JSON.parse(json) as Record<string, number>) : json
    const clean: Record<string, number> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k in DEFAULTS && typeof v === 'number' && Number.isFinite(v)) clean[k] = v
    }
    overrides = clean
  } catch {
    overrides = {}
  }
}

/** 現在の基準値（オーバーライドがあればそれ、無ければ既定） */
export function getConst(key: string): number {
  return key in overrides ? overrides[key] : DEFAULTS[key]
}

export const getConstDefault = (key: string) => DEFAULTS[key]
export const getConstDef = (key: string) => DEFS[key]
export const isOverridden = (key: string) => key in overrides
export const currentOverrides = () => ({ ...overrides })

export const CONST_GROUPS: ConstGroup[] = ['年金（想定）', '子供費用', '児童手当', 'マイホーム', '税制・ふるさと納税']
export const constantsOf = (group: ConstGroup) => CONSTANTS.filter((c) => c.group === group)
