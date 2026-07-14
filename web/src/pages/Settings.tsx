import { useState } from 'react'
import { fetchAll } from '../api'
import { appBaseUrl, mfBookmarklet, rakutenBookmarklet, zaimBookmarklet } from '../bookmarklets'
import { useStore } from '../store'
import type { AllData } from '../types'

function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function Settings() {
  const { config, data, setConfig } = useStore()
  const [url, setUrl] = useState(config?.url ?? '')
  const [token, setToken] = useState(config?.token ?? '')
  const [testResult, setTestResult] = useState('')
  const [copied, setCopied] = useState('')

  const saveAndTest = async () => {
    setTestResult('接続確認中…')
    try {
      await fetchAll({ url: url.trim(), token: token.trim() })
      setConfig({ url: url.trim(), token: token.trim() })
      setTestResult('✅ 接続成功。データを読み込みました。')
    } catch (e) {
      setTestResult(`❌ 接続失敗: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 2000)
  }

  const base = appBaseUrl()

  return (
    <>
      <div className="card">
        <h2>API接続設定</h2>
        <label className="field">GAS ウェブアプリURL
          <input type="url" placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label className="field">APIトークン
          <input type="password" placeholder="setup実行時にログへ表示されたトークン" value={token} onChange={(e) => setToken(e.target.value)} /></label>
        <button className="btn" onClick={() => void saveAndTest()} disabled={!url.trim() || !token.trim()}>保存して接続テスト</button>
        {testResult && <p className="center" style={{ margin: '8px 0 0' }}>{testResult}</p>}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          データの実体はあなたのGoogleドライブ上のスプレッドシート「家計簿DB」に保存されます。
          端末が壊れてもデータは失われません。
        </p>
      </div>

      <div className="card">
        <h2>ブックマークレット（転記を1タップに）</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          下のコードをコピーし、ブラウザのブックマークのURL欄に貼り付けて保存。
          マネフォ/Zaimのページを開いた状態でそのブックマークを開くと、
          数値が入力済みの資産記録画面が立ち上がります。
        </p>
        <p style={{ fontSize: 13, margin: '4px 0' }}>📈 マネーフォワード用（総資産・評価損益・年金）</p>
        <code className="wrap">{mfBookmarklet(base)}</code>
        <button className="btn secondary small" style={{ marginTop: 6 }} onClick={() => void copy('mf', mfBookmarklet(base))}>
          {copied === 'mf' ? 'コピーしました ✓' : 'コピー'}
        </button>
        <p style={{ fontSize: 13, margin: '12px 0 4px' }}>💰 Zaim用（合計残高）</p>
        <code className="wrap">{zaimBookmarklet(base)}</code>
        <button className="btn secondary small" style={{ marginTop: 6 }} onClick={() => void copy('zaim', zaimBookmarklet(base))}>
          {copied === 'zaim' ? 'コピーしました ✓' : 'コピー'}
        </button>
        <p style={{ fontSize: 13, margin: '12px 0 4px' }}>🎁 楽天ふるさと納税用（商品名・金額・自治体・URL）</p>
        <code className="wrap">{rakutenBookmarklet(base)}</code>
        <button className="btn secondary small" style={{ marginTop: 6 }} onClick={() => void copy('rakuten', rakutenBookmarklet(base))}>
          {copied === 'rakuten' ? 'コピーしました ✓' : 'コピー'}
        </button>
        <p className="muted" style={{ fontSize: 12 }}>
          楽天の商品ページを開いた状態でクリックすると、ふるさとタブに商品情報が入力された状態で開きます（自動保存はされないので内容を確認して追加）。
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          ※ページの作りが変わると自動検出できなくなることがあります。その場合は金額の貼り付けを求められます。
        </p>
        <p style={{ fontSize: 13, margin: '4px 0' }}>登録と実行のしかた</p>
        <ul className="muted" style={{ fontSize: 12, paddingLeft: 18, margin: 0 }}>
          <li style={{ marginBottom: 6 }}>
            <b>PC (Chrome/Edge)</b>: ブックマークマネージャー（Ctrl+Shift+O）→「新しいブックマークを追加」→
            URL欄に貼り付け。<b>アドレスバーに直接貼ると「javascript:」が自動で削られて動きません。</b>
            マネフォ/Zaimのページを開いた状態でブックマークバーからクリック。
          </li>
          <li style={{ marginBottom: 6 }}>
            <b>iPhone (Safari)</b>: 適当なページをいったんブックマーク →
            ブックマーク一覧で「編集」→ そのブックマークのURLを消してコードを貼り付け・名前を変更。
            マネフォ/Zaimを開いた状態でブックマーク一覧からタップ。
          </li>
          <li>
            <b>Android (Chrome)</b>: PCと同期したブックマークを使い、マネフォ/Zaimを開いた状態で
            <b>アドレスバーにブックマーク名を入力</b>して候補から選ぶ（ブックマーク一覧からのタップでは実行されません）。
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>CSVエクスポート</h2>
        {(['assets', 'expenses', 'fixed_costs', 'income', 'zaim_net', 'furusato_items', 'furusato_years'] as (keyof AllData)[]).map((name) => {
          const rows = (data?.[name] ?? []) as unknown as Record<string, unknown>[]
          return (
            <button key={name} className="btn secondary" style={{ marginBottom: 8 }}
              disabled={rows.length === 0}
              onClick={() => downloadCsv(name, rows)}>
              {name}.csv をダウンロード（{rows.length}件）
            </button>
          )
        })}
      </div>
    </>
  )
}
