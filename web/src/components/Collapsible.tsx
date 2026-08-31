import type { ReactNode } from 'react'

interface Props {
  title: ReactNode
  /**
   * 閉じているときだけ右端に出す中身の要約（例:「3件」「12項目」「採用上限 12万円」）。
   * 開く前に中身の見当がつくようにするためのもの。
   */
  hint?: ReactNode
  /** 'section' = ページ直下の大きい見出し / 'inline' = カード内の小さい折りたたみ */
  variant?: 'section' | 'inline'
  defaultOpen?: boolean
  onToggle?: (open: boolean) => void
  children: ReactNode
}

/**
 * アプリ共通の折りたたみ。
 *
 * 素の <details> だと「押せる」ことに気づきにくいので、枠線・背景・回転するシェブロンで
 * ボタンらしく見せる。hint の出し分けは CSS（.collapse[open] .collapse-hint）で行うので、
 * このコンポーネント自体は開閉の state を持たない。
 */
export default function Collapsible({ title, hint, variant = 'inline', defaultOpen, onToggle, children }: Props) {
  return (
    <details
      className={`collapse ${variant}`}
      open={defaultOpen}
      onToggle={(e) => onToggle?.((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="collapse-title">{title}</span>
        {hint !== undefined && hint !== null && hint !== '' && <span className="collapse-hint">{hint}</span>}
      </summary>
      {children}
    </details>
  )
}
