import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import HelpTip from '../components/HelpTip'
import PeriodPicker, { inRange, usePeriod } from '../components/PeriodPicker'
import { useStore } from '../store'
import { assetTotal, sortedAssets, thisMonth, today, yen, yenShort } from '../utils'
import LiabilityCard from './LiabilityCard'

const PREFILL_KEYS = ['investment', 'cash', 'pension', 'profit', 'gain'] as const

// 全期間表示でも横軸ラベルが潰れないように間引く
const xTicks = { ticks: { maxTicksLimit: 12, maxRotation: 0 } }

export default function Assets({ prefill }: { prefill: URLSearchParams }) {
  const { data, mutate, saving } = useStore()
  const [date, setDate] = useState(today())
  const [investment, setInvestment] = useState('')
  const [cash, setCash] = useState('')
  const [pension, setPension] = useState('')
  const [profit, setProfit] = useState('')
  const [gain, setGain] = useState('')
  const [memo, setMemo] = useState('')
  const [msg, setMsg] = useState('')
  const appliedPrefill = useRef<string | null>(null)

  const assets = useMemo(() => sortedAssets(data?.assets ?? []), [data])
  // 表示期間（このタブの3グラフ共通。既定=全期間）
  const period = usePeriod(assets.length ? assets[0].date.slice(0, 7) : thisMonth())

  const num = (s: string | undefined) => (!s || s.trim() === '' ? null : Number(s.replace(/[,，]/g, '')))

  /** 指定日の既存記録をフォームへ反映。overrides（プリフィル値）があれば優先 */
  const applyRow = (d: string, overrides?: Partial<Record<(typeof PREFILL_KEYS)[number], string>>) => {
    const hit = assets.find((a) => a.date === d)
    setDate(d)
    setInvestment(overrides?.investment ?? hit?.investment?.toString() ?? '')
    setCash(overrides?.cash ?? hit?.cash?.toString() ?? '')
    setPension(overrides?.pension ?? hit?.pension?.toString() ?? '')
    setProfit(overrides?.profit ?? hit?.mf_profit?.toString() ?? '')
    setGain(overrides?.gain ?? hit?.monthly_gain?.toString() ?? '')
    setMemo(hit?.memo ?? '')
  }

  // ブックマークレットからのプリフィル（#assets?investment=…&autosave=1 など）。
  // データ読み込み後に一度だけ適用し、autosave=1 なら既存の同日記録とマージして自動保存する。
  useEffect(() => {
    if (!data) return
    const key = prefill.toString()
    if (!key || appliedPrefill.current === key) return
    if (!PREFILL_KEYS.some((k) => prefill.get(k)) && !prefill.get('date')) return
    appliedPrefill.current = key

    const d = prefill.get('date') ?? today()
    const overrides: Partial<Record<(typeof PREFILL_KEYS)[number], string>> = {}
    for (const k of PREFILL_KEYS) if (prefill.get(k)) overrides[k] = prefill.get(k)!
    applyRow(d, overrides)

    if (prefill.get('autosave') === '1') {
      const hit = assets.find((a) => a.date === d)
      const row = {
        date: d,
        investment: overrides.investment !== undefined ? num(overrides.investment) : (hit?.investment ?? null),
        cash: overrides.cash !== undefined ? num(overrides.cash) : (hit?.cash ?? null),
        pension: overrides.pension !== undefined ? num(overrides.pension) : (hit?.pension ?? null),
        mf_profit: overrides.profit !== undefined ? num(overrides.profit) : (hit?.mf_profit ?? null),
        monthly_gain: overrides.gain !== undefined ? num(overrides.gain) : (hit?.monthly_gain ?? null),
        memo: hit?.memo ?? '自動記録',
      }
      mutate('upsertAsset', { row })
        .then(() => {
          setMsg(`${d} に自動保存しました ✓`)
          history.replaceState(null, '', '#assets')
        })
        .catch(() => setMsg('自動保存に失敗しました。内容を確認して保存を押してください'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prefill])

  const filtered = useMemo(
    () => assets.filter((a) => inRange(a.date.slice(0, 7), period.from, period.to)),
    [assets, period.from, period.to],
  )

  const profits = filtered.filter((a) => a.mf_profit !== null)

  // 今月の投資増減: 月ごとに最後の記録（月末値）を採用して棒グラフ化
  const gains = useMemo(() => {
    const byMonth = new Map<string, number>()
    for (const a of filtered) if (a.monthly_gain !== null) byMonth.set(a.date.slice(0, 7), a.monthly_gain)
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const save = async () => {
    setMsg('')
    await mutate('upsertAsset', {
      row: { date, investment: num(investment), cash: num(cash), pension: num(pension), mf_profit: num(profit), monthly_gain: num(gain), memo: memo || null },
    })
    setMsg(`${date} の記録を保存しました`)
  }

  const remove = async (d: string) => {
    if (!window.confirm(`${d} の記録を削除しますか？`)) return
    await mutate('deleteAsset', { date: d })
  }

  const lineOpts = {
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    scales: { y: { ticks: { callback: (v: unknown) => yenShort(Number(v)) } }, x: xTicks },
    spanGaps: true,
  }

  return (
    <>
      <div className="card">
        <h2>資産を記録（過去日付もOK）</h2>
        <label className="field">日付<input type="date" value={date} onChange={(e) => applyRow(e.target.value)} /></label>
        <div className="row2">
          <label className="field">投資（マネフォ流動資産）
            <input type="text" inputMode="numeric" placeholder="例: 10070377" value={investment} onChange={(e) => setInvestment(e.target.value)} /></label>
          <label className="field">現金（Zaim残高）
            <input type="text" inputMode="numeric" placeholder="例: 2071561" value={cash} onChange={(e) => setCash(e.target.value)} /></label>
        </div>
        <div className="row2">
          <label className="field">年金
            <input type="text" inputMode="numeric" placeholder="任意" value={pension} onChange={(e) => setPension(e.target.value)} /></label>
          <label className="field">評価損益（投資利益・累計）
            <input type="text" inputMode="numeric" placeholder="任意" value={profit} onChange={(e) => setProfit(e.target.value)} /></label>
        </div>
        <label className="field">
          今月の投資増減
          <HelpTip title="今月の投資増減">
            マネフォの「今月の増減」＝マネフォに登録した投資系資産（投信・株・年金・外貨など）の前月比です。値動きだけでなく、その月の積立入金による増加分も含みます。マネフォ用ブックマークレットで自動入力されます。
          </HelpTip>
          <input type="text" inputMode="numeric" placeholder="任意（例: +355766）" value={gain} onChange={(e) => setGain(e.target.value)} /></label>
        <label className="field">メモ<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        <button className="btn" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
      </div>

      {assets.length >= 2 && <PeriodPicker period={period} note="下の資産グラフ共通" />}

      {filtered.length >= 2 && (
        <div className="card">
          <h2>資産推移</h2>
          <div className="chart-box">
            <Line
              data={{
                labels: filtered.map((a) => a.date.slice(2, 10)),
                datasets: [
                  { label: '合計', data: filtered.map(assetTotal), borderColor: '#38bdf8', tension: 0.3 },
                  { label: '投資', data: filtered.map((a) => a.investment), borderColor: '#4ade80', tension: 0.3 },
                  { label: '現金', data: filtered.map((a) => a.cash), borderColor: '#fbbf24', tension: 0.3 },
                  { label: '年金', data: filtered.map((a) => a.pension), borderColor: '#c084fc', tension: 0.3 },
                ],
              }}
              options={lineOpts}
            />
          </div>
        </div>
      )}

      {profits.length >= 2 && (
        <div className="card">
          <h2>投資利益（評価損益）の推移</h2>
          <div className="chart-box small">
            <Line
              data={{
                labels: profits.map((a) => a.date.slice(2, 10)),
                datasets: [{
                  label: '評価損益',
                  data: profits.map((a) => a.mf_profit),
                  borderColor: '#4ade80',
                  backgroundColor: 'rgba(74, 222, 128, 0.15)',
                  fill: true,
                  tension: 0.3,
                }],
              }}
              options={{ ...lineOpts, plugins: { legend: { display: false } } }}
            />
          </div>
        </div>
      )}

      {gains.length >= 2 && (
        <div className="card">
          <h2>
            今月の投資増減の推移
            <HelpTip title="今月の投資増減の推移">
              各月の最後の記録時点での「今月の増減」（マネフォ投資系資産の前月比）です。月ごとにどれだけ増えた/減ったかの推移を表します。
            </HelpTip>
          </h2>
          <div className="chart-box small">
            <Bar
              data={{
                labels: gains.map(([m]) => m.slice(2)),
                datasets: [{
                  label: '今月の投資増減',
                  data: gains.map(([, v]) => v),
                  backgroundColor: gains.map(([, v]) => (v >= 0 ? '#4ade80' : '#f87171')),
                }],
              }}
              options={{
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { ticks: { callback: (v) => yenShort(Number(v)) } }, x: xTicks },
              }}
            />
          </div>
        </div>
      )}

      <LiabilityCard />

      {assets.length > 0 && (
        <div className="card">
          <h2>記録履歴（新しい順）</h2>
          <ul className="list">
            {[...assets].reverse().slice(0, 50).map((a) => (
              <li key={a.date}>
                <span className="muted" style={{ cursor: 'pointer' }} onClick={() => applyRow(a.date)}>{a.date}</span>
                <span>{yen(assetTotal(a))}</span>
                <button className="btn danger small" onClick={() => void remove(a.date)}>削除</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
