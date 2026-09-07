import { useMemo, useState, type ReactNode } from 'react'

/** 表示件数の選択肢。0 = 全件 */
const LIMITS: Array<[number, string]> = [[3, '3件'], [10, '10件'], [30, '30件'], [0, '全件']]
const DEFAULT_LIMIT = 3

interface Props<T> {
  /** 件数の選択を端末に覚えさせるキー（画面ごとに変える） */
  storageKey: string
  rows: T[]
  keyOf: (row: T) => string
  /** いま編集中の行のキー。一致する行に帯が付く */
  selected?: string | null
  /** 行を押したとき（編集対象にする） */
  onPick?: (row: T) => void
  /** 1段目（見出し・金額など） */
  renderMain: (row: T) => ReactNode
  /** 2段目の内訳。null を返すと出さない */
  renderSub?: (row: T) => ReactNode
  /** 行末のボタン。押下が行へ伝播しないようこちらで包む */
  actions?: (row: T) => ReactNode
  /** 0件のときの文言 */
  empty?: ReactNode
}

/**
 * 「一覧は既定3件・行を押すと編集・行の2段目に内訳」の共通形。
 *
 * 資産タブの記録履歴で作った形を、固定費・負債・ふるさと・収支などでも使う。
 * 件数の選択は画面ごとに端末へ覚えさせる（storageKey）。
 */
export default function PickList<T>({
  storageKey, rows, keyOf, selected, onPick, renderMain, renderSub, actions, empty,
}: Props<T>) {
  const [limit, setLimit] = useState(() => {
    // 未保存(null)を Number() に通すと 0（＝全件）になってしまうので、文字列のまま判定する
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return DEFAULT_LIMIT
    const saved = Number(raw)
    return LIMITS.some(([v]) => v === saved) ? saved : DEFAULT_LIMIT
  })

  const shown = useMemo(() => (limit > 0 ? rows.slice(0, limit) : rows), [rows, limit])

  if (rows.length === 0) return <p className="muted" style={{ fontSize: 13, margin: '4px 0' }}>{empty ?? '登録はありません'}</p>

  return (
    <>
      <ul className="list">
        {shown.map((row) => {
          const k = keyOf(row)
          const sub = renderSub?.(row)
          return (
            <li
              key={k}
              className={`row-pick${selected === k ? ' on' : ''}`}
              role={onPick ? 'button' : undefined}
              tabIndex={onPick ? 0 : undefined}
              onClick={onPick ? () => onPick(row) : undefined}
              onKeyDown={onPick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(row) } } : undefined}
            >
              {renderMain(row)}
              {/* 行の押下で編集に入るので、行末のボタンは伝播を止める */}
              {actions && (
                <span style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  {actions(row)}
                </span>
              )}
              {sub ? <span className="muted row-sub">{sub}</span> : null}
            </li>
          )
        })}
      </ul>
      {rows.length > LIMITS[0][0] && (
        <>
          <div className="seg" style={{ marginTop: 8, marginBottom: 0 }}>
            {LIMITS.map(([v, label]) => (
              <button key={v} className={limit === v ? 'on' : ''}
                onClick={() => { setLimit(v); localStorage.setItem(storageKey, String(v)) }}>{label}</button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
            全{rows.length}件のうち{shown.length}件を表示
          </p>
        </>
      )}
    </>
  )
}
