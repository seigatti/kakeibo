import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'

/**
 * フローティングメモウィンドウ。
 * - position: fixed でスクロール・タブ切替に影響されず画面上の同じ位置に留まる
 * - タイトルバーのドラッグ（Pointer Events）で自由に移動でき、位置は localStorage に保存
 * - メモ本体はGoogleシート（memos）にCRUD
 */

interface Pos {
  x: number
  y: number
}

const POS_KEY = 'kakeibo.memoPos'
const WIN_W = () => Math.min(320, window.innerWidth * 0.9)

function loadPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as Pos
    if (typeof p.x === 'number' && typeof p.y === 'number') return clamp(p)
  } catch {
    /* 初期位置へフォールバック */
  }
  return clamp({ x: window.innerWidth - WIN_W() - 12, y: 64 })
}

function clamp(p: Pos): Pos {
  return {
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - 60)),
    y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - 48)),
  }
}

/** メモの表示件数。0 = 全件 */
const MEMO_LIMITS: Array<[number, string]> = [[3, '3件'], [10, '10件'], [0, '全件']]

export default function MemoWindow({ onClose }: { onClose: () => void }) {
  const { data, mutate, saving } = useStore()
  const [pos, setPos] = useState<Pos>(loadPos)
  const [newText, setNewText] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  const allMemos = [...(data?.memos ?? [])].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  // 既定は直近3件だけ。増やしたいときだけ広げる（選択は端末に覚えさせる）
  const [memoLimit, setMemoLimit] = useState<number>(() => {
    const raw = localStorage.getItem('kakeibo.listLimit.memos')
    if (raw === null) return 3
    const n = Number(raw)
    return MEMO_LIMITS.some(([v]) => v === n) ? n : 3
  })
  const memos = memoLimit > 0 ? allMemos.slice(0, memoLimit) : allMemos

  // 画面リサイズ時にはみ出しを補正
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    setPos(clamp({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy }))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    setPos((p) => {
      localStorage.setItem(POS_KEY, JSON.stringify(p))
      return p
    })
  }

  const add = async () => {
    if (!newText.trim()) return
    await mutate('saveMemo', { row: { text: newText.trim() } })
    setNewText('')
  }

  const save = async (id: string) => {
    const text = (edits[id] ?? '').trim()
    if (!text) return
    await mutate('saveMemo', { row: { id, text } })
    setEdits((e) => {
      const { [id]: _removed, ...rest } = e
      return rest
    })
  }

  const remove = async (id: string) => {
    if (!window.confirm('このメモを削除しますか？')) return
    await mutate('deleteMemo', { id })
  }

  return (
    <div className="memo-window" style={{ left: pos.x, top: pos.y }}>
      <div
        className="memo-titlebar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span>📝 メモ</span>
        <span className="muted" style={{ fontSize: 10 }}>ドラッグで移動</span>
        <button className="memo-close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} title="閉じる">✕</button>
      </div>
      <div className="memo-body">
        <div className="memo-new">
          <textarea rows={2} placeholder="新しいメモ…" value={newText} onChange={(e) => setNewText(e.target.value)} />
          <button className="btn small" style={{ width: 'auto' }} disabled={saving || !newText.trim()} onClick={() => void add()}>追加</button>
        </div>
        {allMemos.length === 0 && <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>メモはまだありません</p>}
        {allMemos.length > MEMO_LIMITS[0][0] && (
          <div className="seg" style={{ marginBottom: 6 }}>
            {MEMO_LIMITS.map(([v, label]) => (
              <button key={v} className={memoLimit === v ? 'on' : ''}
                onClick={() => { setMemoLimit(v); localStorage.setItem('kakeibo.listLimit.memos', String(v)) }}>{label}</button>
            ))}
          </div>
        )}
        {memos.map((m) => {
          const edited = edits[m.id] !== undefined && edits[m.id] !== m.text
          return (
            <div key={m.id} className="memo-item">
              <textarea
                rows={Math.min(6, Math.max(2, (edits[m.id] ?? m.text).split('\n').length))}
                value={edits[m.id] ?? m.text}
                onChange={(e) => setEdits({ ...edits, [m.id]: e.target.value })}
              />
              <div className="memo-item-foot">
                <span className="muted" style={{ fontSize: 10 }}>{m.updated_at ?? ''}</span>
                <span style={{ flex: 1 }} />
                {edited && <button className="btn small" style={{ width: 'auto' }} disabled={saving} onClick={() => void save(m.id)}>保存</button>}
                <button className="btn danger small" disabled={saving} onClick={() => void remove(m.id)}>削除</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
