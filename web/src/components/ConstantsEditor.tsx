import { useMemo, useState } from 'react'
import {
  CONST_GROUPS,
  constantsOf,
  currentOverrides,
  type ConstDef,
} from '../constants'
import HelpTip from './HelpTip'
import { useStore } from '../store'

/**
 * 計算の基準値（定数）の編集UI。
 * グループごとに折りたたみ、各項目に 既定値の併記・出典リンク・要確認バッジ・個別/一括リセットを備える。
 * 保存先は settings シートの constants_override（既定と異なる key だけJSON）。
 */
export default function ConstantsEditor() {
  const { data, mutate, saving } = useStore()
  const thisYear = new Date().getFullYear()

  // 保存済みオーバーライド ＋ 編集中の差分
  const saved = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'constants_override')?.value
    try {
      return raw ? (JSON.parse(raw) as Record<string, number>) : {}
    } catch {
      return {}
    }
  }, [data])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')

  // 表示用の現在値（編集中 > 保存済み > 既定）
  const currentStr = (c: ConstDef): string => {
    if (c.key in edits) return edits[c.key]
    if (c.key in saved) return String(saved[c.key])
    return String(c.default)
  }
  const currentNum = (c: ConstDef): number => {
    const s = currentStr(c)
    const n = Number(s.replace(/[,，]/g, ''))
    return Number.isFinite(n) ? n : c.default
  }
  const isChanged = (c: ConstDef) => currentNum(c) !== c.default

  // 最終的に保存する override（既定と異なるものだけ）
  const buildOverrides = (): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const g of CONST_GROUPS) {
      for (const c of constantsOf(g)) {
        const v = currentNum(c)
        if (v !== c.default) out[c.key] = v
      }
    }
    return out
  }

  const save = async () => {
    setMsg('')
    await mutate('setSetting', { row: { key: 'constants_override', value: JSON.stringify(buildOverrides()) } })
    setEdits({})
    setMsg('基準値を保存しました ✓')
  }

  const resetOne = (c: ConstDef) => setEdits({ ...edits, [c.key]: String(c.default) })

  const resetAll = async () => {
    if (!window.confirm('すべての基準値を初期値（デフォルト）に戻しますか？')) return
    await mutate('setSetting', { row: { key: 'constants_override', value: '{}' } })
    setEdits({})
    setMsg('すべて初期値に戻しました ✓')
  }

  const dirty = Object.keys(edits).length > 0 || JSON.stringify(buildOverrides()) !== JSON.stringify(saved)
  const overrideCount = Object.keys(currentOverrides()).length

  return (
    <div className="card">
      <h2>
        計算の基準値（定数）
        <HelpTip title="計算の基準値について">
          ふるさと納税の上限計算やライフプランの試算で使う制度の数値・想定値です。
          現在の値は初期値（デフォルト）で、必要な人だけ調整できます。各項目の「？」に出典サイトのリンクがあります。
          {'\n'}「要確認」は毎年〜数年で改定されうる値で、初期値が反映している年度より後になったら出典で最新値をご確認ください。
        </HelpTip>
      </h2>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        グループを開いて編集し「保存」してください。所得税率など法定のテーブルは末尾に参考表示（編集不可）。
      </p>

      {CONST_GROUPS.map((g) => {
        const items = constantsOf(g)
        const changedInGroup = items.filter(isChanged).length
        const needsReview = items.filter((c) => c.annual && thisYear > c.reviewYear).length
        return (
          <details key={g} style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
            <summary style={{ cursor: 'pointer', fontSize: 14 }}>
              {g}
              {changedInGroup > 0 && <span style={{ color: 'var(--accent)', fontSize: 11 }}>（{changedInGroup}件変更）</span>}
              {needsReview > 0 && <span style={{ color: 'var(--amber)', fontSize: 11 }}> ⚠要確認{needsReview}</span>}
            </summary>
            <div style={{ marginTop: 8 }}>
              {items.map((c) => {
                const review = c.annual && thisYear > c.reviewYear
                return (
                  <div key={c.key} style={{ marginBottom: 10 }}>
                    <label className="field" style={{ marginBottom: 2 }}>
                      <span>
                        {c.label}
                        <HelpTip title={c.label}>
                          既定値: {c.default.toLocaleString()}{c.unit}（{c.reviewYear}年度基準）
                          {c.note ? `\n${c.note}` : ''}
                          {'\n'}
                          <a href={c.source.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                            出典: {c.source.label}
                          </a>
                        </HelpTip>
                        {review && <span style={{ color: 'var(--amber)', fontSize: 10, marginLeft: 4 }}>⚠要確認</span>}
                      </span>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={currentStr(c)}
                          onChange={(e) => setEdits({ ...edits, [c.key]: e.target.value })}
                          style={isChanged(c) ? { borderColor: 'var(--accent)' } : undefined}
                        />
                        <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{c.unit}</span>
                      </span>
                    </label>
                    <div className="muted" style={{ fontSize: 11, display: 'flex', gap: 8 }}>
                      <span>既定: {c.default.toLocaleString()}{c.unit}</span>
                      {isChanged(c) && (
                        <button className="linklike" onClick={() => resetOne(c)}>この項目を既定に戻す</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </details>
        )
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={() => void save()} disabled={saving || !dirty}>{saving ? '保存中…' : '基準値を保存'}</button>
        <button className="btn danger" style={{ width: 'auto' }} onClick={() => void resetAll()} disabled={saving || overrideCount === 0}>
          すべて既定に戻す
        </button>
      </div>
      {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
      <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
        現在 {overrideCount} 項目が既定から変更されています。基準値はふるさと納税・ライフプランの計算に共通で使われます。
      </p>
    </div>
  )
}
