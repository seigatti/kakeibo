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
  /** 詳細版だけで聞く質問は 'detail' */
  mode: 'both' | 'detail'
  options: SurveyOption[]
}

const CAR_PRICE = 2_500_000 // 1台あたりの想定買い替え費用
export const CAR_LABEL = '車の買い替え'
export const CARE_LABEL = '親の介護'

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
    question: '子供の学校はどう想定しますか？',
    mode: 'both',
    options: [
      { value: 'public', label: 'すべて公立', note: '大学も国公立' },
      { value: 'mixed', label: '公立中心・大学は私立' },
      { value: 'private', label: '中学から私立', note: '大学も私立' },
    ],
  },
  {
    id: 'course',
    question: '子供の進路と住まいは？',
    mode: 'both',
    options: [
      { value: 'high', label: '高卒まで' },
      { value: 'univ_home', label: '大学・実家から' },
      { value: 'univ_alone', label: '大学・一人暮らし' },
      { value: 'grad', label: '大学院まで', note: '一人暮らし想定' },
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
    id: 'invest_ratio',
    question: '収入のうち、どのくらいを資産運用に回したいですか？',
    mode: 'both',
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
    mode: 'both',
    options: [
      { value: 'flat', label: '変わらない' },
      { value: 'mild', label: '少し上がる', note: '昇給率 −0.3%' },
      { value: 'steep', label: 'かなり上がる', note: '昇給率 −0.8%' },
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
      { value: '2', label: '標準', note: '2%' },
      { value: '3', label: '高めが続く', note: '3%' },
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
]

export const questionsFor = (mode: SurveyMode) =>
  SURVEY_QUESTIONS.filter((q) => (mode === 'detail' ? true : q.mode === 'both'))

/** その質問セットの既定回答（＝各質問の最初の選択肢） */
export function defaultAnswers(mode: SurveyMode): SurveyAnswers {
  const out: SurveyAnswers = {}
  for (const q of questionsFor(mode)) out[q.id] = q.options[0].value
  return out
}

const CHILD_OFFSETS = [1, 3, 5] // 何年後に生まれる想定か

/** 回答から新しいシナリオ設定を作る。回答が触れない項目は base のまま */
export function buildConfigFromAnswers(
  answers: SurveyAnswers,
  base: LifeplanConfig,
  thisYear: number = new Date().getFullYear(),
): LifeplanConfig {
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

  // 学校（全員に一括適用）
  if (answers.school) {
    const s = answers.school
    cfg.children = cfg.children.map((c) => ({
      ...c,
      elementary: s === 'private' ? '私立' : '公立',
      junior: s === 'private' ? '私立' : '公立',
      high: s === 'public' ? '公立' : '私立',
      college: s === 'public' ? '国公立' : '私立',
    }))
  }

  // 進路と住まい
  if (answers.course) {
    const map: Record<string, Pick<LifeplanChild, 'path' | 'living'>> = {
      high: { path: '高卒', living: '実家' },
      univ_home: { path: '大卒', living: '実家' },
      univ_alone: { path: '大卒', living: '一人暮らし' },
      grad: { path: '大学院', living: '一人暮らし' },
    }
    const m = map[answers.course]
    if (m) cfg.children = cfg.children.map((c) => ({ ...c, ...m }))
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

  // 税・社会保険料の見通し → 手取りの伸び（昇給率）を鈍らせる形で反映
  if (answers.tax) {
    const drag = answers.tax === 'steep' ? 0.8 : answers.tax === 'mild' ? 0.3 : 0
    cfg.raise_rate = Math.round((base.raise_rate - drag) * 10) / 10
  }

  // ---- 詳細版 ----
  if (answers.style) cfg.invest_return = Number(answers.style)
  if (answers.inflation) cfg.inflation = Number(answers.inflation)
  if (answers.retire) cfg.adults = cfg.adults.map((a) => ({ ...a, retire_age: Number(answers.retire) }))
  if (answers.living) cfg.living_cost = answers.living === 'auto' ? null : Number(answers.living)

  return cfg
}
