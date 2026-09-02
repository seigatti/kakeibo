import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import MemoWindow from './MemoWindow'
import { setConstantOverrides } from './constants'
import { setMasked } from './utils'
import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import Cashflow from './pages/Cashflow'
import FixedCosts from './pages/FixedCosts'
import Furusato from './pages/Furusato'
import Lifeplan from './pages/Lifeplan'
import Settings from './pages/Settings'

const TABS = [
  { id: 'home', label: 'ホーム', icon: '🏠' },
  { id: 'assets', label: '資産', icon: '📈' },
  { id: 'cashflow', label: '収支', icon: '💰' },
  { id: 'fixed', label: '固定費', icon: '📋' },
  { id: 'furusato', label: 'ふるさと', icon: '🎁' },
  { id: 'lifeplan', label: 'プラン', icon: '📅' },
  { id: 'settings', label: '設定', icon: '⚙️' },
] as const

type TabId = (typeof TABS)[number]['id']

function parseHash(): { tab: TabId; params: URLSearchParams } {
  const hash = location.hash.replace(/^#\/?/, '')
  const [tab, query] = hash.split('?')
  const valid = TABS.some((t) => t.id === tab) ? (tab as TabId) : 'home'
  return { tab: valid, params: new URLSearchParams(query ?? '') }
}

export default function App() {
  const { config, data, loading, error, lastFailed, stale, retry, refresh } = useStore()
  const [route, setRoute] = useState(parseHash)
  const [memoOpen, setMemoOpen] = useState(localStorage.getItem('kakeibo.memoOpen') === '1')
  const [masked, setMaskedState] = useState(localStorage.getItem('kakeibo.masked') === '1')

  const toggleMemo = (open: boolean) => {
    setMemoOpen(open)
    localStorage.setItem('kakeibo.memoOpen', open ? '1' : '0')
  }

  const toggleMask = () => {
    const next = !masked
    setMaskedState(next)
    localStorage.setItem('kakeibo.masked', next ? '1' : '0')
  }

  // 子コンポーネントの描画前にモジュールフラグへ反映（yen/yenShort/amt がマスクされる）
  setMasked(masked)
  // 計算の基準値オーバーライドを反映（データ読込後、計算する各ページの描画前）
  setConstantOverrides(data?.settings.find((s) => s.key === 'constants_override')?.value)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // ヘッダーの実高さを CSS 変数へ。表示期間バーの sticky(top) がこれを参照する
  // （高さは env(safe-area-inset-top) を含むので CSS だけでは正確に出せない）
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const apply = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 未設定なら設定画面へ誘導
  const tab: TabId = config ? route.tab : 'settings'

  return (
    <div className={masked ? 'app masked' : 'app'}>
      <header className="header" ref={headerRef}>
        <h1>家計簿</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={masked ? 'icon-btn on' : 'icon-btn'} onClick={toggleMask}
            title={masked ? '金額マスク中（クリックで表示）' : '金額をマスク'}>
            {masked ? '🙈' : '👁'}
          </button>
          <button className={memoOpen ? 'icon-btn on' : 'icon-btn'} onClick={() => toggleMemo(!memoOpen)} title="メモ">
            📝
          </button>
          <button className="icon-btn" onClick={() => void refresh(true)} disabled={loading} title="再読み込み（必ず最新を取得）">
            {loading ? '…' : '↻'}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner error">
          <span>⚠ {error}{lastFailed ? '（表示は保存前に戻しました）' : ''}</span>
          {lastFailed && (
            <button className="btn small secondary" style={{ width: 'auto', marginTop: 0 }} onClick={() => void retry()}>
              再試行
            </button>
          )}
        </div>
      )}
      {!config && tab !== 'settings' && <div className="banner">設定画面でAPI接続情報を入力してください</div>}
      {stale && (
        <div className="banner">
          <span>📴 オフライン表示中（前回のデータ。最新の取得に失敗しました）</span>
          <button className="btn small secondary" style={{ width: 'auto', marginTop: 0 }} onClick={() => void refresh(true)}>
            再取得
          </button>
        </div>
      )}

      <main className="main">
        {tab === 'home' && <Dashboard />}
        {tab === 'assets' && <Assets prefill={route.params} />}
        {tab === 'cashflow' && <Cashflow />}
        {tab === 'fixed' && <FixedCosts />}
        {tab === 'furusato' && <Furusato prefill={route.params} />}
        {tab === 'lifeplan' && <Lifeplan />}
        {tab === 'settings' && <Settings />}
        {config && !data && loading && <p className="muted center">読み込み中…</p>}
      </main>

      {memoOpen && <MemoWindow onClose={() => toggleMemo(false)} />}

      <nav className="tabbar">
        {TABS.map((t) => (
          <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'tab active' : 'tab'}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </a>
        ))}
      </nav>
    </div>
  )
}
