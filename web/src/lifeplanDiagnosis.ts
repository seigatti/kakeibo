/**
 * シナリオの「前提の厳しさ」診断（純関数）。
 *
 * simulate は純関数で81年分の計算も軽いので、**項目ごとに標準値へ戻して再計算**し、
 * 「その前提が結果をどれだけ悪くしているか」を実測する。
 * 標準値は constants.ts（設定タブで編集可・出典つき）から引く。
 */
import { getConst } from './constants.ts'
import type { LifeplanConfig, LifeplanResult } from './lifeplan.ts'
import { isMasked } from './utils.ts'

export interface DiagnosisFactor {
  key: string
  label: string
  /** 表示用の現在値・標準値 */
  current: string
  standard: string
  /** 現在の設定が標準より厳しい側か */
  harsher: boolean
  /** 標準に合わせたときの評価年の資産の差（名目・プラス=改善） */
  deltaAssets: number
  /** 同じ差を「今の価値」（インフレで割り戻した実質）で見たもの */
  deltaAssetsReal: number
  depletionBefore: number | null
  depletionAfter: number | null
  /** なぜその値が標準なのかの一文 */
  why: string
  /** 「標準に合わせる」で当てる差分 */
  patch: Partial<LifeplanConfig>
}

export interface Diagnosis {
  depletionYear: number | null
  /** 実際に評価した年（世帯主が80歳になる年など。UIのラベル用） */
  evalYear: number
  /** 評価年の資産（名目・実質） */
  baseAssets: number
  baseAssetsReal: number
  /** 標準より厳しい前提を、影響（今の価値）の大きい順に並べたもの */
  factors: DiagnosisFactor[]
  /** 厳しい前提をすべて標準にそろえた場合 */
  allStandard: {
    depletionYear: number | null
    deltaAssets: number
    deltaAssetsReal: number
    patch: Partial<LifeplanConfig>
  } | null
}

export interface DiagnosisContext {
  /** 給与データからの年金想定額（大人の名前→年額） */
  pensionEstimate: Record<string, number>
  /** 実支出からの基本生活費の推定（年額）。無ければ null */
  livingEstimate: number | null
  /** 影響を測る年（例: 世帯主が80歳になる年）。未指定・範囲外なら最終年で評価する */
  evalYear?: number
}

const pct = (v: number) => `${Math.round(v * 10) / 10}%`
const round1 = (v: number) => Math.round(v * 10) / 10
/** 万円表示（金額マスクに対応） */
const man = (v: number) => (isMasked() ? '＊＊＊万円' : `${Math.round(v / 10_000).toLocaleString('ja-JP')}万円`)

/** 候補（標準より厳しいときだけ診断対象にする） */
interface Candidate {
  key: string
  label: string
  current: string
  standard: string
  harsher: boolean
  why: string
  patch: Partial<LifeplanConfig>
}

function candidates(cfg: LifeplanConfig, ctx: DiagnosisContext): Candidate[] {
  const out: Candidate[] = []
  const stdInflation = getConst('std_inflation')
  const slide = getConst('pension_slide')
  const retireRatio = getConst('living_retire_ratio')
  const stdReturn = getConst('std_invest_return')
  const stdRatio = getConst('std_invest_ratio')
  const stdRetireAge = getConst('std_retire_age')

  // 年金の上昇率（物価にほぼ連動して改定される想定が標準）
  const pensionStd = round1(cfg.inflation - slide)
  out.push({
    key: 'pension_growth',
    label: '年金の上昇率',
    current: pct(cfg.pension_growth ?? 0),
    standard: pct(pensionStd),
    harsher: (cfg.pension_growth ?? 0) < pensionStd - 0.05,
    why: `年金は物価にほぼ連動して改定されます（マクロスライドで物価上昇より ${slide}% 低い想定）。0%は受給額が生涯据え置きという、かなり厳しい前提です。`,
    patch: { pension_growth: pensionStd },
  })

  // 実質賃金（昇給率 − インフレ率）
  const realWage = round1(cfg.raise_rate - cfg.inflation)
  out.push({
    key: 'real_wage',
    label: '実質賃金（昇給率 − インフレ率）',
    current: pct(realWage),
    standard: '0%',
    harsher: realWage < -0.05,
    why: '標準は「物価と同じだけ賃上げされる（実質横ばい）」です。マイナスにすると手取りが毎年 実質的に目減りし続ける前提になります。',
    patch: { raise_rate: cfg.inflation },
  })

  // 退職後の基本生活費
  const curRatio = cfg.living_cost_retire_ratio ?? 100
  out.push({
    key: 'living_cost_retire_ratio',
    label: '退職後の基本生活費',
    current: `現役期の ${pct(curRatio)}`,
    standard: `現役期の ${pct(retireRatio)}`,
    harsher: curRatio > retireRatio + 0.05,
    why: '家計調査では高齢無職世帯の消費支出は現役期より小さくなります。100%のままだと、退職後も現役と同額を使い続ける前提になります。',
    patch: { living_cost_retire_ratio: retireRatio },
  })

  // インフレ率
  out.push({
    key: 'inflation',
    label: 'インフレ率',
    current: pct(cfg.inflation),
    standard: pct(stdInflation),
    harsher: cfg.inflation > stdInflation + 0.05,
    why: '標準は日銀の物価安定の目標（2%）です。これより高く見積もると支出だけが先に膨らみます。',
    patch: { inflation: stdInflation },
  })

  // 運用利回り
  out.push({
    key: 'invest_return',
    label: '運用利回り',
    current: pct(cfg.invest_return),
    standard: pct(stdReturn),
    harsher: cfg.invest_return < stdReturn - 0.05,
    why: '長期の分散投資の控えめな目安が標準です。',
    patch: { invest_return: stdReturn },
  })

  // 収入のうち投資へ回す割合
  out.push({
    key: 'invest_ratio',
    label: '収入のうち投資へ回す割合',
    current: pct(cfg.invest_ratio ?? 0),
    standard: pct(stdRatio),
    harsher: (cfg.invest_ratio ?? 0) < stdRatio - 0.05,
    why: '黒字を現金のまま置いておくと利回りが効きません。標準は収入の一定割合を積み立てる前提です。',
    patch: { invest_ratio: stdRatio },
  })

  // 退職年齢
  const minRetire = Math.min(...cfg.adults.filter((a) => a.income_enabled).map((a) => a.retire_age), 999)
  if (Number.isFinite(minRetire) && minRetire < 999) {
    out.push({
      key: 'retire_age',
      label: '退職年齢',
      current: `${minRetire}歳`,
      standard: `${stdRetireAge}歳`,
      harsher: minRetire < stdRetireAge,
      why: '標準は年金の受給開始と揃う65歳です。早く辞めるほど収入のない期間が延びます。',
      patch: { adults: cfg.adults.map((a) => (a.income_enabled && a.retire_age < stdRetireAge ? { ...a, retire_age: stdRetireAge } : a)) },
    })
  }

  // 年金額を手動で想定より低くしている場合
  const lowPension = cfg.adults.filter((a) => a.pension !== null && a.pension < (ctx.pensionEstimate[a.name] ?? 0) * 0.95)
  if (lowPension.length > 0) {
    const curSum = lowPension.reduce((s, a) => s + (a.pension ?? 0), 0)
    const estSum = lowPension.reduce((s, a) => s + (ctx.pensionEstimate[a.name] ?? 0), 0)
    out.push({
      key: 'pension_amount',
      label: `年金額（${lowPension.map((a) => a.name).join('・')}）`,
      current: man(curSum),
      standard: man(estSum),
      harsher: true,
      why: '給与データから想定される年金額より低く手入力されています。空欄にすると想定額が使われます。',
      patch: { adults: cfg.adults.map((a) => (lowPension.includes(a) ? { ...a, pension: null } : a)) },
    })
  }

  // 基本生活費を実績推定より高くしている場合
  if (cfg.living_cost !== null && ctx.livingEstimate !== null && cfg.living_cost > ctx.livingEstimate * 1.05) {
    out.push({
      key: 'living_cost',
      label: '基本生活費',
      current: man(cfg.living_cost),
      standard: `${man(ctx.livingEstimate)}（実支出から推定）`,
      harsher: true,
      why: '直近の実支出から推定した額より高く設定されています。',
      patch: { living_cost: null },
    })
  }

  return out
}

/**
 * @param run 同じ開始資産・収入前提でシミュレートするクロージャ（呼び出し側が注入）
 */
export function diagnoseScenario(cfg: LifeplanConfig, run: (c: LifeplanConfig) => LifeplanResult, ctx: DiagnosisContext): Diagnosis {
  // 評価する行（既定は最終年。evalYear があればその年）
  const pick = (r: LifeplanResult) =>
    (ctx.evalYear !== undefined ? r.rows.find((x) => x.year === ctx.evalYear) : undefined) ?? r.rows[r.rows.length - 1]

  const baseResult = run(cfg)
  const baseRow = pick(baseResult)
  const baseAssets = baseRow.assetsNominal
  const baseAssetsReal = baseRow.assetsReal
  const depletionBefore = baseResult.depletionYear

  const harsh = candidates(cfg, ctx).filter((c) => c.harsher)
  const factors: DiagnosisFactor[] = harsh.map((c) => {
    const r = run({ ...cfg, ...c.patch })
    const row = pick(r)
    return {
      key: c.key,
      label: c.label,
      current: c.current,
      standard: c.standard,
      harsher: true,
      deltaAssets: row.assetsNominal - baseAssets,
      deltaAssetsReal: row.assetsReal - baseAssetsReal,
      depletionBefore,
      depletionAfter: r.depletionYear,
      why: c.why,
      patch: c.patch,
    }
  })
  // インフレ率を戻す要因は名目と実質で効き方が違うので「今の価値」で並べる
  factors.sort((a, b) => b.deltaAssetsReal - a.deltaAssetsReal)

  let allStandard: Diagnosis['allStandard'] = null
  if (harsh.length > 0) {
    // patch は adults を丸ごと差し替えるものがあるので順に重ねる
    let merged: Partial<LifeplanConfig> = {}
    let acc = cfg
    for (const c of harsh) {
      acc = { ...acc, ...c.patch }
      merged = { ...merged, ...c.patch }
    }
    // adults を触る patch が複数あると後勝ちになるため、最終状態から作り直す
    merged = { ...merged, adults: acc.adults }
    const r = run(acc)
    const row = pick(r)
    allStandard = {
      depletionYear: r.depletionYear,
      deltaAssets: row.assetsNominal - baseAssets,
      deltaAssetsReal: row.assetsReal - baseAssetsReal,
      patch: merged,
    }
  }

  return { depletionYear: depletionBefore, evalYear: baseRow.year, baseAssets, baseAssetsReal, factors, allStandard }
}
