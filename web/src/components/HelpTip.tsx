import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 「？」ボタン。タップでその場に説明バブルを表示する（モバイル前提なのでクリック開閉）。
 * 画面右寄りにあるときはバブルを右揃えにしてはみ出しを防ぐ。
 */
export default function HelpTip({ title, children, label }: { title?: string; children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [open])

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault() // label内でもinputへフォーカスさせない
    e.stopPropagation()
    if (!open && ref.current) {
      setAlignRight(ref.current.getBoundingClientRect().left > window.innerWidth / 2)
    }
    setOpen(!open)
  }

  return (
    <span className="helptip" ref={ref}>
      <button type="button" className={label ? 'btn small secondary' : 'helptip-btn'} onClick={toggle} aria-label={label ?? '説明を表示'}>{label ?? '?'}</button>
      {open && (
        <span className={alignRight ? 'helptip-pop right' : 'helptip-pop'} onClick={(e) => e.stopPropagation()}>
          {title && <b style={{ display: 'block', marginBottom: 4 }}>{title}</b>}
          {children}
        </span>
      )}
    </span>
  )
}
