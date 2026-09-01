import { useState } from 'react'
import { addMonths, thisMonth, type Unit } from '../utils'

export type Preset = 'year' | '12m' | 'all' | 'custom'

const PRESETS: [Preset, string][] = [
  ['year', '今年'],
  ['12m', '過去12ヶ月'],
  ['all', '全期間'],
  ['custom', '期間指定'],
]

/**
 * プリセット→[開始月, 終了月]。既定（all）は最古〜当月。
 * custom は「両方入力済みのときだけ採用」だと、片方だけ変えても効かず
 * 期間指定が反応しないように見えるため、未入力の側は既定値（最古 / 当月）で補う。
 * 終了月は未来でもよい（データが無くてもグラフの横軸は伸びる。負債の返済推移を見るため）。
 */
export function rangeOf(preset: Preset, month: string, earliest: string, cf: string, ct: string): [string, string] {
  if (preset === 'year') return [`${month.slice(0, 4)}-01`, month]
  if (preset === '12m') return [addMonths(month, -11), month]
  if (preset === 'custom') return [cf || earliest, ct || month]
  return [earliest, month]
}

/** 月が範囲内か（YYYY-MM の辞書順比較） */
export function inRange(m: string, from: string, to: string): boolean {
  return m >= from && m <= to
}

export interface Period {
  preset: Preset
  setPreset: (p: Preset) => void
  /** グラフの点の単位（月ごと / 年ごと） */
  unit: Unit
  setUnit: (u: Unit) => void
  cf: string
  setCf: (v: string) => void
  ct: string
  setCt: (v: string) => void
  /** 解決済みの範囲 */
  from: string
  to: string
  earliest: string
}

/**
 * セクション単位の表示期間。既定は「全期間」。
 * @param earliest そのセクションのデータが存在する最古の月（'all' と custom の既定値に使う）
 */
export function usePeriod(earliest: string): Period {
  const [preset, setPreset] = useState<Preset>('all')
  const [cf, setCf] = useState('')
  const [ct, setCt] = useState('')
  const [unit, setUnit] = useState<Unit>('month')
  const month = thisMonth()
  const [from, to] = rangeOf(preset, month, earliest, cf, ct)
  return { preset, setPreset, unit, setUnit, cf, setCf, ct, setCt, from, to, earliest }
}

/**
 * 期間選択UI（このセクションの全グラフが参照する）。
 * @param unitToggle 月/年の切替を出すか（対応済みのページだけ true にする）
 */
export default function PeriodPicker({ period, note, unitToggle }: { period: Period; note?: string; unitToggle?: boolean }) {
  const { preset, setPreset, unit, setUnit, cf, setCf, ct, setCt, from, to, earliest } = period
  return (
    <div className="card period-picker">
      <div className="seg">
        {PRESETS.map(([p, label]) => (
          <button key={p} className={preset === p ? 'on' : ''} onClick={() => setPreset(p)}>{label}</button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="row2">
          <label className="field">開始月
            <input type="month" value={cf || earliest} onChange={(e) => setCf(e.target.value)} /></label>
          <label className="field">終了月
            <input type="month" value={ct || thisMonth()} onChange={(e) => setCt(e.target.value)} /></label>
        </div>
      )}
      {unitToggle && (
        <div className="seg" style={{ marginBottom: 8 }}>
          <button className={unit === 'month' ? 'on' : ''} onClick={() => setUnit('month')}>月単位</button>
          <button className={unit === 'year' ? 'on' : ''} onClick={() => setUnit('year')}>年単位</button>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        表示期間: {from} 〜 {to}
        {note ? `（${note}）` : ''}
        {preset === 'custom' && to > thisMonth() && <><br />※終了月が未来なので、負債の返済予定は先まで表示されます（実績が無い資産・収支は途切れます）</>}
      </p>
    </div>
  )
}
