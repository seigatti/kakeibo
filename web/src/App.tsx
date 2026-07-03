import { useEffect, useState } from 'react'
import { useStore } from './store'
import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import Cashflow from './pages/Cashflow'
import FixedCosts from './pages/FixedCosts'
import Settings from './pages/Settings'

const TABS = [
  { id: 'home', label: 'ホーム', icon: '🏠' },
  { id: 'assets', label: '資産', icon: '📈' },
  { id: 'cashflow', label: '収支', icon: '💰' },
  { id: 'fixed', label: '固定費', icon: '📋' },
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
  const { config, data, loading, error, refresh } = useStore()
  const [route, setRoute] = useState(parseHash)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 未設定なら設定画面へ誘導
  const tab: TabId = config ? route.tab : 'settings'

  return (
    <div className="app">
      <header className="header">
        <h1>家計簿</h1>
        <button className="icon-btn" onClick={() => void refresh()} disabled={loading} title="再読み込み">
          {loading ? '…' : '↻'}
        </button>
      </header>

      {error && <div className="banner error">⚠ {error}</div>}
      {!config && tab !== 'settings' && <div className="banner">設定画面でAPI接続情報を入力してください</div>}

      <main className="main">
        {tab === 'home' && <Dashboard />}
        {tab === 'assets' && <Assets prefill={route.params} />}
        {tab === 'cashflow' && <Cashflow />}
        {tab === 'fixed' && <FixedCosts />}
        {tab === 'settings' && <Settings />}
        {config && !data && loading && <p className="muted center">読み込み中…</p>}
      </main>

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
