/**
 * アンケートからライフプランのシナリオを組み立てる（純関数）。
 * 回答は選択肢ベース。回答が触れない項目は base（現在の設定）をそのまま引き継ぐので、
 * 大人（実際の給与データ由来）や既存のカスタム収支などは失われない。
 */
import type { CustomFlow, LifeplanChild, LifeplanConfig } from './lifeplan.ts'

export type SurveyMode = 'simple' | 'detail'
/** 質問ID → 選択した選択肢の value */
export type SurveyAnswers = Record<string, string>

export interface SurveyOption {
  value: string
  label: string
  /** 選ぶと何がどうなるかの短い説明（UIに出す） */
  note?: string
}

export interface SurveyQuestion {
  id: string
  question: string
  /** both=両方 / simple=簡易版だけの「方針」質問 / detail=詳細版だけ */
  mode: 'both' | 'simple' | 'detail'
  /** 既定の回答（省略時は先頭の選択肢） */
  defaultValue?: string
  options: SurveyOption[]
}

const CAR_PRICE = 2_500_000 // 1台あたりの想定買い替え費用
export const CAR_LABEL = '車の買い替え'
export const CARE_LABEL = '親の介護'

/** 「一般的な支出」テンプレで作る行のラベル接頭辞（再適用・削除の目印） */
export const STD_PREFIX = '一般:'
export type StandardLevel = 'none' | 'standard' | 'high'

const REPAIR_CYCLE_YEARS = 15
const REPAIR_COST = 2_000_000 // 大規模修繕1回あたり
const APPLIANCE_ANNUAL = 50_000 // 家電の買い替え（年額に均した額）
const CEREMONY_ANNUAL = 100_000 // 冠婚葬祭・帰省など
/** 医療費（自己負担の目安・1人あたり年額）。年齢帯ごと */
const MEDICAL_TIERS: Array<{ from: number; to: number; annual: number }> = [
  { from: 60, to: 69, annual: 100_000 },
  { from: 70, to: 79, annual: 200_000 },
  { from: 80, to: 100, annual: 300_000 },
]

/**
 * 一般的なライフイベント支出のテンプレ行。
 * ラベルは STD_PREFIX 付きにしてあり、再適用時は同じ接頭辞の行を入れ替える想定。
 * level='high' は各額を1.5倍。'none' は空配列（＝呼び出し側で既存行が消える）。
 */
export function standardExpenseFlows(
  cfg: LifeplanConfig,
  level: StandardLevel,
  thisYear: number = new Date().getFullYear(),
): CustomFlow[] {
  if (level === 'none') return []
  const k = level === 'high' ? 1.5 : 1
  const end = thisYear + 80
  const out: CustomFlow[] = []

  if (cfg.home?.enabled) {
    out.push({
      label: `${STD_PREFIX}住宅の大規模修繕`,
      start_year: cfg.home.buy_year,
      end_year: end,
      annual: -Math.round((REPAIR_COST / REPAIR_CYCLE_YEARS) * k),
    })
  }
  out.push({ label: `${STD_PREFIX}家電の買い替え`, start_year: thisYear, end_year: end, annual: -Math.round(APPLIANCE_ANNUAL * k) })
  out.push({ label: `${STD_PREFIX}冠婚葬祭・帰省など`, start_year: thisYear, end_year: end, annual: -Math.round(CEREMONY_ANNUAL * k) })

  for (const a of cfg.adults) {
    if (!a.birth_year) continue
    for (const t of MEDICAL_TIERS) {
      const from = Math.max(thisYear, a.birth_year + t.from)
      const to = Math.min(end, a.birth_year + t.to)
      if (from > to) continue
      out.push({
        label: `${STD_PREFIX}医療費（${a.name}・${t.from}${t.from >= 80 ? '歳〜' : '代'}）`,
        start_year: from,
        end_year: to,
        annual: -Math.round(t.annual * k),
      })
    }
  }
  return out
}

/** 既存のカスタム収支から「一般的な支出」行を入れ替える（手入力した行は残す） */
export function applyStandardExpenses(cfg: LifeplanConfig, level: StandardLevel, thisYear?: number): CustomFlow[] {
  const kept = cfg.custom_flows.filter((f) => !f.label.startsWith(STD_PREFIX))
  return [...kept, ...standardExpenseFlows(cfg, level, thisYear)]
}

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: 'children',
    question: '子供は何人を想定しますか？',
    mode: 'both',
    options: [
      { value: 'keep', label: '現在のまま', note: '今の子供設定を変えません' },
      { value: '0', label: '0人' },
      { value: '1', label: '1人', note: '翌年生まれで作成' },
      { value: '2', label: '2人', note: '翌年・3年後生まれ' },
      { value: '3', label: '3人', note: '翌年・3年後・5年後生まれ' },
    ],
  },
  {
    id: 'school',
    question: '小・中・高はどこから私立に通う想定ですか？',
    mode: 'detail',
    options: [
      { value: 'public', label: 'すべて公立' },
      { value: 'high', label: '高校から私立', note: '小・中は公立' },
      { value: 'junior', label: '中学から私立', note: '小学校は公立' },
    ],
  },
  {
    id: 'college',
    question: '大学は国公立・私立のどちらを想定しますか？',
    mode: 'detail',
    options: [
      { value: 'public', label: '国公立' },
      { value: 'private', label: '私立' },
    ],
  },
  {
    id: 'course',
    question: '子供はどこまで進学する想定ですか？',
    mode: 'detail',
    defaultValue: 'univ',
    options: [
      { value: 'high', label: '高校まで' },
      { value: 'univ', label: '大学まで' },
      { value: 'grad', label: '大学院まで' },
    ],
  },
  {
    id: 'child_living',
    question: '大学以降の住まいは？',
    mode: 'detail',
    options: [
      { value: 'home', label: '実家から通う' },
      { value: 'alone', label: '一人暮らし', note: '生活費の加算あり' },
    ],
  },
  {
    id: 'car',
    question: '車はどのくらいの頻度で買い替えますか？',
    mode: 'both',
    options: [
      { value: 'none', label: '持たない' },
      { value: '15', label: '15年ごと' },
      { value: '10', label: '10年ごと' },
      { value: '7', label: '7年ごと' },
    ],
  },
  {
    id: 'withdraw',
    question: '老後、投資をどう取り崩しますか？',
    mode: 'both',
    options: [
      { value: 'none', label: '取り崩さない', note: '計画的な取り崩しはせず、現金が足りないときだけ取り崩す' },
      { value: 'rate4', label: '毎年4%', note: '投資残高の4%を現金化（いわゆる4%ルール）。退職の年から' },
      { value: 'rate3', label: '毎年3%', note: '投資残高の3%を現金化（長持ち重視）。退職の年から' },
      { value: 'amount200', label: '年200万', note: '毎年200万円を現金化（物価に合わせて増額）。退職の年から' },
      { value: 'amount300', label: '年300万', note: '毎年300万円を現金化（物価に合わせて増額）。退職の年から' },
      { value: 'amount500', label: '年500万', note: '毎年500万円を現金化（物価に合わせて増額）。退職の年から' },
    ],
  },
  {
    id: 'shortfall',
    question: '取り崩しても現金が足りなくなったら？',
    mode: 'both',
    options: [
      { value: 'cover', label: '不足分だけ補う', note: '足りない分だけ投資を現金化する' },
      { value: 'floor100', label: '現金100万を保つ', note: '現金が100万円を下回らないよう投資を現金化する' },
      { value: 'floor300', label: '現金300万を保つ', note: '現金が300万円を下回らないよう投資を現金化する' },
      { value: 'none', label: '補わない', note: '投資には手を付けない（現金がマイナスになることがあります）' },
    ],
  },
  {
    id: 'withdraw_skip',
    question: '現金が十分あるときは、その年の取り崩しを止めますか？',
    mode: 'both',
    options: [
      { value: '0', label: '止めない', note: '毎年ルールどおりに取り崩す' },
      { value: '30', label: '現金比率30%以上で止める', note: '現金 ÷（現金＋投資）が30%以上の年は取り崩さない' },
      { value: '50', label: '50%以上で止める', note: '現金 ÷（現金＋投資）が50%以上の年は取り崩さない' },
      { value: '70', label: '70%以上で止める', note: '現金 ÷（現金＋投資）が70%以上の年は取り崩さない' },
    ],
  },
  {
    id: 'invest_ratio',
    question: '収入のうち、どのくらいを資産運用に回したいですか？',
    mode: 'detail',
    options: [
      { value: '0', label: '0%', note: '黒字は現金のまま' },
      { value: '10', label: '10%' },
      { value: '20', label: '20%' },
      { value: '30', label: '30%' },
    ],
  },
  {
    id: 'home',
    question: '住まいはどう想定しますか？',
    mode: 'both',
    options: [
      { value: 'rent', label: '賃貸のまま' },
      { value: '5', label: '5年後に購入' },
      { value: '10', label: '10年後に購入' },
    ],
  },
  {
    id: 'tax',
    question: '税金・社会保険料は今後どうなると思いますか？',
    mode: 'detail',
    options: [
      { value: 'flat', label: '変わらない' },
      { value: 'mild', label: '少し上がる', note: '昇給率 −0.3%' },
      { value: 'steep', label: 'かなり上がる', note: '昇給率 −0.8%' },
    ],
  },
  {
    id: 'standard',
    question: '一般的なライフイベント費用（住宅修繕・家電・冠婚葬祭・医療費）を含めますか？',
    mode: 'detail',
    options: [
      { value: 'none', label: '含めない' },
      { value: 'standard', label: '標準で含める', note: '家電5万/年・冠婚葬祭10万/年・医療費は年齢に応じて増加' },
      { value: 'high', label: '多めに見る', note: '標準の1.5倍' },
    ],
  },
  // ---- ここから詳細版だけの質問 ----
  {
    id: 'style',
    question: '資産運用のスタイルは？',
    mode: 'detail',
    options: [
      { value: '1', label: '預金中心', note: '利回り 1%' },
      { value: '3', label: 'バランス', note: '利回り 3%' },
      { value: '5', label: '株式中心', note: '利回り 5%' },
    ],
  },
  {
    id: 'inflation',
    question: '物価（インフレ）はどうなると思いますか？',
    mode: 'detail',
    options: [
      { value: '1', label: '落ち着く', note: '1%' },
      { value: '1.5', label: 'やや低め', note: '1.5%' },
      { value: '2', label: '標準', note: '2%（日銀の目標）' },
      { value: '3', label: 'やや高め', note: '3%' },
      { value: '4', label: '高め', note: '4%' },
      { value: '5', label: 'かなり高い', note: '5%' },
      { value: '6', label: '非常に高い', note: '6%' },
      { value: '7', label: '極めて高い', note: '7%' },
    ],
  },
  {
    id: 'real_wage',
    question: '実質賃金（物価を差し引いた手取りの伸び）はどうなると思いますか？',
    mode: 'detail',
    options: [
      { value: '0.5', label: '上がる', note: '昇給率 = インフレ率 + 0.5%' },
      { value: '0', label: '横ばい', note: '昇給率 = インフレ率（物価と同じだけ賃上げ）' },
      { value: '-0.5', label: '少し下がる', note: '昇給率 = インフレ率 − 0.5%' },
      { value: '-1', label: '下がる', note: '昇給率 = インフレ率 − 1%' },
      { value: '-2', label: '大きく下がる', note: '昇給率 = インフレ率 − 2%' },
    ],
  },
  {
    id: 'retire',
    question: '何歳まで働く想定ですか？',
    mode: 'detail',
    options: [
      { value: '60', label: '60歳' },
      { value: '65', label: '65歳' },
      { value: '70', label: '70歳' },
    ],
  },
  {
    id: 'living',
    question: '基本生活費（子供費用を除く）の水準は？',
    mode: 'detail',
    options: [
      { value: 'auto', label: '実績から自動' },
      { value: '3000000', label: '節約', note: '年300万' },
      { value: '4000000', label: '標準', note: '年400万' },
      { value: '5000000', label: 'ゆとり', note: '年500万' },
    ],
  },
  {
    id: 'care',
    question: '親の介護費用は想定しますか？',
    mode: 'detail',
    options: [
      { value: 'none', label: '想定しない' },
      { value: 'light', label: '5年間・年100万' },
      { value: 'heavy', label: '10年間・年150万' },
    ],
  },
  // ---- ここから簡易版だけの「方針」質問（1問で詳細の複数項目が決まる） ----
  {
    id: 'policy_education',
    question: '子供の教育方針は？',
    mode: 'simple',
    options: [
      { value: 'public', label: '公立中心' },
      { value: 'mixed', label: '私立も視野' },
      { value: 'best', label: 'できる限り良い教育' },
    ],
  },
  {
    id: 'policy_money',
    question: '家計の方針は？',
    mode: 'simple',
    options: [
      { value: 'saver', label: '堅実に貯める' },
      { value: 'balance', label: 'バランス' },
      { value: 'enjoy', label: '今を楽しむ' },
    ],
  },
  {
    id: 'policy_future',
    question: '将来の見通しは？',
    mode: 'simple',
    options: [
      { value: 'optimistic', label: '楽観的' },
      { value: 'normal', label: '標準的' },
      { value: 'cautious', label: '慎重' },
    ],
  },
]

/** 方針の回答 → 詳細質問の回答。ここを変えれば画面の説明（answerEffects）も自動で追従する */
export const POLICY_MAP: Record<string, Record<string, SurveyAnswers>> = {
  policy_education: {
    public: { school: 'public', college: 'public', course: 'univ', child_living: 'home' },
    mixed: { school: 'high', college: 'private', course: 'univ', child_living: 'alone' },
    best: { school: 'junior', college: 'private', course: 'grad', child_living: 'alone' },
  },
  policy_money: {
    saver: { invest_ratio: '30', living: '3000000', standard: 'standard', style: '3' },
    balance: { invest_ratio: '20', living: 'auto', standard: 'standard', style: '3' },
    enjoy: { invest_ratio: '10', living: '5000000', standard: 'high', style: '1' },
  },
  policy_future: {
    optimistic: { inflation: '1', real_wage: '0.5', tax: 'flat', retire: '60' },
    normal: { inflation: '2', real_wage: '0', tax: 'mild', retire: '65' },
    cautious: { inflation: '3', real_wage: '-1', tax: 'steep', retire: '70' },
  },
}

/** 方針の回答を詳細質問の回答へ展開。詳細で明示された回答があればそちらを優先する */
export function expandPolicyAnswers(answers: SurveyAnswers): SurveyAnswers {
  const derived: SurveyAnswers = {}
  for (const [pid, table] of Object.entries(POLICY_MAP)) {
    const chosen = answers[pid]
    if (chosen && table[chosen]) Object.assign(derived, table[chosen])
  }
  return { ...derived, ...answers }
}

const findQ = (id: string) => SURVEY_QUESTIONS.find((q) => q.id === id)

/**
 * 選んだ回答で何が決まるかを人が読める行にする。
 * 方針の質問は POLICY_MAP を引いて「詳細質問 → 選択肢」を並べるので、
 * 対応表を変えれば説明も自動で追従する（手書きの説明とズレない）。
 */
export interface EffectContext {
  /** 実支出からの基本生活費の推定（「実績から自動」の実額表示に使う） */
  livingEstimate?: { annual: number; months: number } | null
}

export function answerEffects(questionId: string, value: string, ctx?: EffectContext): string[] {
  // 「実績から自動」は実際にいくらで計算されるかを出す
  if (questionId === 'living' && value === 'auto') {
    const e = ctx?.livingEstimate
    return e && e.annual > 0
      ? [`直近${e.months}ヶ月の実支出から推定: 約${Math.round(e.annual / 10_000).toLocaleString('ja-JP')}万円/年`]
      : ['実支出のデータが足りないため 0円 として計算されます（金額を選ぶこともできます）']
  }
  const table = POLICY_MAP[questionId]?.[value]
  if (table) {
    return Object.entries(table).map(([qid, val]) => {
      const q = findQ(qid)
      const opt = q?.options.find((o) => o.value === val)
      const label = q?.question.replace(/[？?]$/, '') ?? qid
      return `${label} → ${opt?.label ?? val}${opt?.note ? `（${opt.note}）` : ''}`
    })
  }
  const note = findQ(questionId)?.options.find((o) => o.value === value)?.note
  return note ? [note] : []
}

export const questionsFor = (mode: SurveyMode) =>
  SURVEY_QUESTIONS.filter((q) => q.mode === 'both' || q.mode === mode)

/** その質問セットの既定回答（＝各質問の最初の選択肢） */
export function defaultAnswers(mode: SurveyMode): SurveyAnswers {
  const out: SurveyAnswers = {}
  for (const q of questionsFor(mode)) out[q.id] = q.defaultValue ?? q.options[0].value
  return out
}

const CHILD_OFFSETS = [1, 3, 5] // 何年後に生まれる想定か

/** 回答から新しいシナリオ設定を作る。回答が触れない項目は base のまま */
export function buildConfigFromAnswers(
  rawAnswers: SurveyAnswers,
  base: LifeplanConfig,
  thisYear: number = new Date().getFullYear(),
): LifeplanConfig {
  // 簡易版の「方針」回答を詳細項目へ展開してから組み立てる
  const answers = expandPolicyAnswers(rawAnswers)
  const cfg: LifeplanConfig = {
    ...base,
    adults: base.adults.map((a) => ({ ...a })),
    children: base.children.map((c) => ({ ...c })),
    custom_flows: base.custom_flows.map((f) => ({ ...f })),
    home: { ...base.home },
  }

  // 子供の人数（「現在のまま」なら触らない）
  if (answers.children && answers.children !== 'keep') {
    const n = Number(answers.children)
    cfg.children = Array.from({ length: n }, (_, i): LifeplanChild => ({
      birth_year: thisYear + (CHILD_OFFSETS[i] ?? 5 + (i - 2) * 2),
      nursery: true,
      elementary: '公立',
      junior: '公立',
      high: '公立',
      path: '大卒',
      college: '国公立',
      living: '実家',
    }))
  }

  // 小・中・高（私立が始まる段階。大学は別の質問で決める）
  if (answers.school) {
    const from = ({ public: 99, high: 2, junior: 1 } as Record<string, number>)[answers.school] ?? 99 // 1=中学 2=高校
    cfg.children = cfg.children.map((c) => ({
      ...c,
      elementary: '公立',
      junior: from <= 1 ? '私立' : '公立',
      high: from <= 2 ? '私立' : '公立',
    }))
  }

  // 大学（国公立 / 私立）
  if (answers.college) {
    const college: LifeplanChild['college'] = answers.college === 'private' ? '私立' : '国公立'
    cfg.children = cfg.children.map((c) => ({ ...c, college }))
  }

  // どこまで進学するか
  if (answers.course) {
    const path = ({ high: '高卒', univ: '大卒', grad: '大学院' } as Record<string, LifeplanChild['path']>)[answers.course]
    if (path) cfg.children = cfg.children.map((c) => ({ ...c, path }))
  }

  // 大学以降の住まい
  if (answers.child_living) {
    const living: LifeplanChild['living'] = answers.child_living === 'alone' ? '一人暮らし' : '実家'
    cfg.children = cfg.children.map((c) => ({ ...c, living }))
  }

  // カスタム収支（車・介護）はアンケート管理分を入れ直す（手入力した他の項目は残す）
  const others = cfg.custom_flows.filter((f) => f.label !== CAR_LABEL && f.label !== CARE_LABEL)
  const added: CustomFlow[] = []
  if (answers.car && answers.car !== 'none') {
    const years = Number(answers.car)
    added.push({
      label: CAR_LABEL,
      start_year: thisYear,
      end_year: thisYear + 80,
      annual: -Math.round(CAR_PRICE / years), // 買い替え費用を年額に均した額
    })
  }
  if (answers.care && answers.care !== 'none') {
    const heavy = answers.care === 'heavy'
    added.push({
      label: CARE_LABEL,
      start_year: thisYear + 10,
      end_year: thisYear + 10 + (heavy ? 9 : 4),
      annual: heavy ? -1_500_000 : -1_000_000,
    })
  }
  cfg.custom_flows = [...others, ...added]

  if (answers.invest_ratio) cfg.invest_ratio = Number(answers.invest_ratio)

  // 住まい
  if (answers.home) {
    if (answers.home === 'rent') cfg.home = { ...cfg.home, enabled: false }
    else cfg.home = { ...cfg.home, enabled: true, buy_year: thisYear + Number(answers.home) }
  }

  // ---- 詳細版 ----
  if (answers.style) cfg.invest_return = Number(answers.style)
  if (answers.inflation) cfg.inflation = Number(answers.inflation)

  // 昇給率（名目）= インフレ率 + 実質賃金 − 税・社会保険料の負担増。
  // インフレ率を確定させてから計算する（実質賃金0なら 昇給率 = インフレ率）
  const taxDrag = answers.tax === 'steep' ? 0.8 : answers.tax === 'mild' ? 0.3 : 0
  if (answers.real_wage !== undefined) {
    cfg.raise_rate = Math.round((cfg.inflation + Number(answers.real_wage) - taxDrag) * 10) / 10
  } else if (answers.tax) {
    cfg.raise_rate = Math.round((base.raise_rate - taxDrag) * 10) / 10 // 実質賃金の回答が無い古い回答との互換
  }
  if (answers.retire) cfg.adults = cfg.adults.map((a) => ({ ...a, retire_age: Number(answers.retire) }))
  if (answers.living) cfg.living_cost = answers.living === 'auto' ? null : Number(answers.living)

  // 取り崩し。開始年は「収入のある大人の退職年の最大値」＝働き終える年
  if (answers.withdraw) {
    const retireYears = cfg.adults
      .filter((a) => a.birth_year && a.income_enabled)
      .map((a) => a.birth_year! + a.retire_age)
    const startYear = retireYears.length ? Math.max(...retireYears) : thisYear + 30
    const w = answers.withdraw
    if (w === 'none') {
      cfg.withdraw_mode = 'none'
    } else if (w.startsWith('rate')) {
      cfg.withdraw_mode = 'rate'
      cfg.withdraw_value = Number(w.replace('rate', ''))
      cfg.withdraw_start_year = startYear
    } else if (w.startsWith('amount')) {
      cfg.withdraw_mode = 'amount'
      cfg.withdraw_value = Number(w.replace('amount', '')) * 10_000
      cfg.withdraw_start_year = startYear
    }
  }

  if (answers.withdraw_skip !== undefined) cfg.withdraw_skip_cash_ratio = Number(answers.withdraw_skip)

  // 現金が足りなくなったときの扱い
  if (answers.shortfall) {
    const sf = answers.shortfall
    cfg.shortfall_cover = sf !== 'none'
    cfg.cash_floor = sf === 'floor100' ? 1_000_000 : sf === 'floor300' ? 3_000_000 : 0
  }

  // 一般的な支出は住まい・大人が確定したあとで組み立てる
  if (answers.standard) cfg.custom_flows = applyStandardExpenses(cfg, answers.standard as StandardLevel, thisYear)

  return cfg
}
