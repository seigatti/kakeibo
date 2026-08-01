import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 「？」ボタン。タップでその場に説明バブルを表示する（モバイル前提なのでクリック開閉）。
 * 吹き出しは position:fixed でボタン位置から画面内に収まるよう配置するため、
 * 横スクロール表やカードの overflow に影響されず見切れない。縦に長い説明は内部スクロール。
 */
export default function HelpTip({ title, children, label }: { title?: string; children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number }>({
    left: 0, width: 300, top: 0, maxHeight: 400,
  })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: Event) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    // ページのスクロール/リサイズで閉じる（吹き出し内のスクロールは無視）
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('click', onDoc)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('click', onDoc)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault() // label内でもinputへフォーカスさせない
    e.stopPropagation()
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const width = Math.min(300, window.innerWidth - 16)
      let left = r.left
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
      if (left < 8) left = 8
      const below = window.innerHeight - r.bottom - 8 // ボタン下の空き
      const above = r.top - 8 // ボタン上の空き
      // 下に十分な余白があれば下に、無ければ広い方へ。入る高さに max-height を合わせて内部スクロール
      if (below >= 220 || below >= above) {
        setPos({ left, width, top: r.bottom + 4, maxHeight: below })
      } else {
        setPos({ left, width, bottom: window.innerHeight - r.top + 4, maxHeight: above })
      }
    }
    setOpen(!open)
  }

  return (
    <span className="helptip">
      <button ref={btnRef} type="button" className={label ? 'btn small secondary' : 'helptip-btn'} onClick={toggle} aria-label={label ?? '説明を表示'}>{label ?? '?'}</button>
      {open && (
        <span className="helptip-pop" ref={popRef}
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
          onClick={(e) => e.stopPropagation()}>
          {title && <b style={{ display: 'block', marginBottom: 4 }}>{title}</b>}
          {children}
        </span>
      )}
    </span>
  )
}
