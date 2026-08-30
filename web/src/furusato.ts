/**
 * ふるさと納税の検索・還元率・候補選定（純関数）。
 *
 * UIから切り離してテストできるようにしている。
 * シートの空欄は '' で返ってくるので、数値は必ず toNum() を通して受ける。
 */
import type { FurusatoItem } from './types.ts'

/** シート由来の値を数値に。空欄('')・null・非数は null */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,，]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 優先度 1〜5（未設定は3） */
export function priorityOf(it: FurusatoItem): number {
  const p = toNum(it.priority)
  if (p === null) return 3
  return Math.max(1, Math.min(5, Math.round(p)))
}

/** 還元率(0〜1)。市場価格か寄付金額が無ければ null */
export function returnRate(it: FurusatoItem): number | null {
  const market = toNum(it.market_price)
  const price = toNum(it.price)
  if (market === null || price === null || price <= 0) return null
  return market / price
}

/** 候補（＝まだ寄付していないもの）か。対象年が無い、または未購入 */
export function isCandidate(it: FurusatoItem): boolean {
  return !toNum(it.year) || it.application_status === '未購入'
}

// ------------------------------------------------------------------ 検索

export interface ItemFilter {
  /** 商品名・自治体・メモを部分一致（大小文字無視） */
  text: string
  /** '' = すべて */
  status: string
  receipt: '' | '未' | '済'
  /** '' = すべて / 'candidate' = 候補(年なし) / '2026' */
  year: string
  minPrice: number | null
  maxPrice: number | null
}

export const EMPTY_FILTER: ItemFilter = { text: '', status: '', receipt: '', year: '', minPrice: null, maxPrice: null }

/** 1つでも条件が入っているか（入っていなければ通常の2リスト表示に戻す） */
export function isFilterActive(f: ItemFilter): boolean {
  return f.text.trim() !== '' || f.status !== '' || f.receipt !== '' || f.year !== '' || f.minPrice !== null || f.maxPrice !== null
}

export function filterItems(items: FurusatoItem[], f: ItemFilter): FurusatoItem[] {
  const q = f.text.trim().toLowerCase()
  return items.filter((it) => {
    if (q !== '') {
      const hay = `${it.name ?? ''} ${it.municipality ?? ''} ${it.memo ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (f.status !== '' && (it.application_status ?? '') !== f.status) return false
    // 受取は未入力を「未」として扱う（済と明示されたものだけが済）
    if (f.receipt !== '') {
      const r = it.receipt_status === '済' ? '済' : '未'
      if (r !== f.receipt) return false
    }
    if (f.year !== '') {
      const y = toNum(it.year)
      if (f.year === 'candidate') {
        if (y) return false
      } else if (String(y ?? '') !== f.year) return false
    }
    const price = toNum(it.price)
    if (f.minPrice !== null && (price === null || price < f.minPrice)) return false
    if (f.maxPrice !== null && (price === null || price > f.maxPrice)) return false
    return true
  })
}

// -------------------------------------------------------------- 候補選定

export type PickMode = 'priority' | 'rate' | 'balance'

export const PICK_MODES: Array<{ value: PickMode; label: string; note: string }> = [
  { value: 'priority', label: '優先度重視', note: '点数 = 寄付額 × 優先度。欲しい順に限度額を使い切る' },
  { value: 'rate', label: '還元率重視', note: '点数 = 寄付額 × 還元率。もらえる返礼品の価値を最大化' },
  { value: 'balance', label: 'バランス', note: '点数 = 寄付額 × 還元率 × 優先度' },
]

/**
 * 点数。寄付額が高いほど・優先度が高いほど大きくなる。
 * @param stdRate 市場価格が未入力のときに使う標準還元率(0〜1)
 */
export function itemScore(it: FurusatoItem, mode: PickMode, stdRate: number): number {
  const price = toNum(it.price) ?? 0
  const rate = returnRate(it) ?? stdRate
  const pri = priorityOf(it)
  if (mode === 'priority') return price * pri
  if (mode === 'rate') return price * rate
  return price * rate * pri
}

export interface PickResult {
  chosen: FurusatoItem[]
  rest: FurusatoItem[]
  /** 採用分の寄付額合計 */
  total: number
  /** 採用分の点数合計 */
  score: number
}

/** DPの表の最大セル数。これを超えるときは粒度を粗くして打ち切る */
const MAX_CELLS = 20_000

function gcd2(a: number, b: number): number {
  while (b > 0) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

/**
 * DPの粒度(円)を決める。寄付額と予算の最大公約数を使うと、
 * 千円単位の寄付額なら表が数百セルで済み、端数があっても**ぴったり収まる組合せを取り逃がさない**。
 * 公約数が小さすぎて表が膨れる場合だけ、粒度を粗くする（安全側に丸めるので予算は超えない）。
 */
function pickUnit(prices: number[], budget: number): number {
  const g = prices.reduce((a, b) => gcd2(a, b), budget)
  const unit = Math.max(1, g)
  if (Math.floor(budget / unit) <= MAX_CELLS) return unit
  return Math.ceil(budget / MAX_CELLS)
}

/**
 * 予算内で総点数が最大になる組合せ（0/1ナップサック）。
 * 対象は候補・未購入かつ寄付額が正のものだけ。合計は**予算を1円も超えない**。
 */
export function pickCandidates(items: FurusatoItem[], budget: number, mode: PickMode, stdRate: number): PickResult {
  const targets = items.filter((it) => isCandidate(it) && (toNum(it.price) ?? 0) > 0)
  if (budget <= 0 || targets.length === 0) return { chosen: [], rest: targets, total: 0, score: 0 }

  const prices = targets.map((it) => toNum(it.price) ?? 0)
  const unit = pickUnit(prices, budget)
  const cap = Math.floor(budget / unit)
  // 重さは切り上げ＝予算を超えない側に倒す（粒度が公約数なら切り上げは起きない）
  const weights = prices.map((p) => Math.ceil(p / unit))

  // best[c] = 容量c以下で得られる最大点数 / take[i][c] = 品i を採用したか
  const best = new Array<number>(cap + 1).fill(0)
  const take: Uint8Array[] = []
  targets.forEach((it, i) => {
    const w = weights[i]
    const v = itemScore(it, mode, stdRate)
    const row = new Uint8Array(cap + 1)
    // 容量の大きい側から更新すると、同じ品を2回使わずに済む
    for (let c = cap; c >= w; c--) {
      const cand = best[c - w] + v
      if (cand > best[c]) {
        best[c] = cand
        row[c] = 1
      }
    }
    take.push(row)
  })

  // 採用した品を復元する
  const chosenSet = new Set<number>()
  let c = cap
  for (let i = targets.length - 1; i >= 0; i--) {
    if (take[i][c]) {
      chosenSet.add(i)
      c -= weights[i]
    }
  }

  const chosen = targets.filter((_, i) => chosenSet.has(i))
  const rest = targets.filter((_, i) => !chosenSet.has(i))
  return {
    chosen,
    rest,
    total: chosen.reduce((s, it) => s + (toNum(it.price) ?? 0), 0),
    score: chosen.reduce((s, it) => s + itemScore(it, mode, stdRate), 0),
  }
}

/** 採用分の平均還元率(0〜1)。市場価格が入っているものだけで平均する。無ければ null */
export function averageRate(list: FurusatoItem[]): number | null {
  const rated = list.filter((it) => returnRate(it) !== null)
  if (rated.length === 0) return null
  const price = rated.reduce((s, it) => s + (toNum(it.price) ?? 0), 0)
  const market = rated.reduce((s, it) => s + (toNum(it.market_price) ?? 0), 0)
  return price > 0 ? market / price : null
}
