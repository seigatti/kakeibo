/**
 * 年齢別の「世間の平均」との比較用の系列（純関数）。
 *
 * グラフは名目値なので、現在価格の統計をそのまま重ねると年が進むほど不当に低く見える。
 * そこで **現在価格の平均 × (1+インフレ)^経過年** で名目化してから重ねる。
 * 平均値は constants.ts（設定タブで編集可・出典つき）から引く。
 */
import { getConst } from './constants.ts'

/** 世帯主の年齢階級別 平均世帯年収（額面・現在価格）。出典: 厚労省 国民生活基礎調査 */
export function avgHouseholdIncomeGross(age: number): number {
  if (age <= 29) return getConst('avg_income_20s')
  if (age <= 39) return getConst('avg_income_30s')
  if (age <= 49) return getConst('avg_income_40s')
  if (age <= 59) return getConst('avg_income_50s')
  if (age <= 69) return getConst('avg_income_60s')
  return getConst('avg_income_70plus')
}

/**
 * 手取り換算した平均世帯年収。
 * プラン側の給与は手取りなので、額面のままだと平均が高く見えてしまうため揃える。
 */
export function avgHouseholdIncomeNet(age: number): number {
  return avgHouseholdIncomeGross(age) * getConst('net_to_gross')
}

/** 世帯主の年齢階級別 平均世帯貯蓄（現在価格）。出典: 総務省 家計調査（貯蓄・負債編） */
export function avgHouseholdAssets(age: number): number {
  if (age <= 39) return getConst('avg_assets_u40')
  if (age <= 49) return getConst('avg_assets_40s')
  if (age <= 59) return getConst('avg_assets_50s')
  if (age <= 69) return getConst('avg_assets_60s')
  return getConst('avg_assets_70plus')
}

export interface BenchmarkPoint {
  year: number
  age: number
  /** 手取り換算・名目（インフレ換算後） */
  incomeNet: number
  /** 貯蓄現在高・名目（インフレ換算後） */
  assets: number
}

/**
 * 各年の比較値。現在価格の平均に (1+インフレ)^経過年 を掛けて名目化する。
 * @param years 対象の年（グラフの横軸）
 * @param birthYear 世帯主の生年
 * @param inflationPct インフレ率(%)
 * @param startYear 現在価格の基準年（＝シミュレーションの開始年）
 */
export function benchmarkSeries(years: number[], birthYear: number, inflationPct: number, startYear: number): BenchmarkPoint[] {
  return years.map((year) => {
    const age = year - birthYear
    const infl = Math.pow(1 + inflationPct / 100, year - startYear)
    return {
      year,
      age,
      incomeNet: Math.round(avgHouseholdIncomeNet(age) * infl),
      assets: Math.round(avgHouseholdAssets(age) * infl),
    }
  })
}
