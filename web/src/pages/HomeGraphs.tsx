import { useMemo, useState } from 'react'
import { Bar, Chart, Doughnut, Line } from 'react-chartjs-2'
import HelpTip from '../components/HelpTip'
import { CONSUMPTION_UNITS, type AllData } from '../types'
import {
  addMonths,
  assetAllocationTrend,
  assetTotal,
  categoryStats,
  DEFAULT_PRINCIPAL_CAP,
  dataMonthRange,
  effectiveIncomeByMonth,
  estimateOtherExpense,
  expenseByMonth,
  expenseComposition,
  fixedCostBreakdown,
  fixedMonthlyTotal,
  monthRange,
  netSalaryByMonth,
  netWorthByMonth,
  nonInvestBreakdownByMonth,
  otherIncomeByMonth,
  periodSummary,
  savingsRateByMonth,
  sortedAssets,
  thisMonth,
  totalLiabilitiesAt,
  yen,
  yenShort,
} from '../utils'

type Preset = 'year' | '12m' | 'all' | 'custom'

/** プリセット→[開始月, 終了月]。custom は両方入力済みのときのみ採用、既定は最古〜当月 */
function rangeOf(preset: Preset, month: string, earliest: string, cf: string, ct: string): [string, string] {
  if (preset === 'year') return [`${month.slice(0, 4)}-01`, month]
  if (preset === '12m') return [addMonths(month, -11), month]
  if (preset === 'custom' && cf && ct) return [cf, ct]
  return [earliest, month]
}

const PRESETS: [Preset, string][] = [['year', '今年'], ['12m', '過去12ヶ月'], ['all', '全期間'], ['custom', '期間指定']]

const PALETTE = ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#fb923c', '#2dd4bf', '#a3e635', '#f472b6', '#60a5fa']

const donutOpts = (items: { value: number }[]) => {
  const total = items.reduce((s, a) => s + a.value, 0)
  return {
    maintainAspectRatio: false,
    cutout: '55%',
    plugins: {
      legend: { position: 'right' as const, labels: { boxWidth: 12, font: { size: 11 } } },
      datalabels: {
        display: (ctx: { dataIndex: number }) => total > 0 && items[ctx.dataIndex].value / total >= 0.05,
        color: '#0f172a',
        font: { size: 11, weight: 'bold' as const },
        formatter: (v: number) => `${Math.round((v / total) * 100)}%`,
      },
    },
  }
}

export default function HomeGraphs({ data }: { data: AllData }) {
  const principalCap = useMemo(() => {
    const raw = data.settings.find((s) => s.key === 'principal_cap')?.value
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PRINCIPAL_CAP
  }, [data])

  const month = thisMonth()
  const assets = useMemo(() => sortedAssets(data.assets), [data])
  const latest = assets[assets.length - 1]
  const prev = assets[assets.length - 2]

  // ---- 期間集計の状態 ----
  const [preset, setPreset] = useState<Preset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  // ---- 貯蓄率の期間指定 ----
  const [srPreset, setSrPreset] = useState<Preset>('12m')
  const [srFrom, setSrFrom] = useState('')
  const [srTo, setSrTo] = useState('')
  // ---- カテゴリ別集計の期間指定 ----
  const [statPreset, setStatPreset] = useState<Preset>('12m')
  const [statFrom, setStatFrom] = useState('')
  const [statTo, setStatTo] = useState('')

  // ---- 資産 ----
  const allocation = useMemo(() => {
    const items = [
      { label: '投資', value: latest?.investment ?? 0, color: '#4ade80' },
      { label: '現金', value: latest?.cash ?? 0, color: '#38bdf8' },
      { label: '年金', value: latest?.pension ?? 0, color: '#c084fc' },
    ].filter((a) => a.value > 0)
    return { items, total: items.reduce((s, a) => s + a.value, 0) }
  }, [latest])
  const allocTrend = useMemo(() => assetAllocationTrend(data.assets).slice(-24), [data])
  const liabilities = data.liabilities ?? []
  const netWorthSeries = useMemo(() => netWorthByMonth(data.assets, liabilities).slice(-24), [data, liabilities])
  const assetRecent = assets.slice(-24)
  const profits = assets.filter((a) => a.mf_profit !== null).slice(-24)
  const gains = useMemo(() => {
    const byMonth = new Map<string, number>()
    for (const a of assets) if (a.monthly_gain !== null) byMonth.set(a.date.slice(0, 7), a.monthly_gain)
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-24)
  }, [assets])

  // ---- 収支 ----
  const netByMonth = useMemo(() => netSalaryByMonth(data.furusato_salaries ?? []), [data])
  const otherByMonth = useMemo(() => otherIncomeByMonth(data.furusato_salaries ?? []), [data])
  const months = useMemo(() => dataMonthRange(data.expenses, [], [...netByMonth.keys(), ...otherByMonth.keys()]), [data, netByMonth, otherByMonth])
  const chartMonths = months.slice(-24)
  const incMap = useMemo(() => effectiveIncomeByMonth(data.furusato_salaries ?? []), [data])
  const expMap = useMemo(() => expenseByMonth(data.expenses), [data])
  const breakdown = useMemo(() => nonInvestBreakdownByMonth(data.assets, principalCap), [data, principalCap])
  const fixedOf = (m: string) => fixedMonthlyTotal(data.fixed_costs, m)
  const otherOf = (m: string) => estimateOtherExpense(incMap.get(m) ?? 0, fixedOf(m), expMap.get(m) ?? 0, breakdown.get(m)?.delta)
  const totalExp = (m: string) => fixedOf(m) + (expMap.get(m) ?? 0) + (otherOf(m) ?? 0)

  const catTrend = useMemo(() => {
    const byCat = new Map<string, Map<string, number>>()
    for (const e of data.expenses) {
      if (!byCat.has(e.category)) byCat.set(e.category, new Map())
      byCat.get(e.category)!.set(e.month, e.amount)
    }
    return byCat
  }, [data])

  const earliestMonth = months.length ? months[0] : month

  // 貯蓄率（期間指定）＋ 最大/平均/最小
  const [srFromR, srToR] = rangeOf(srPreset, month, earliestMonth, srFrom, srTo)
  const savingsRate = useMemo(
    () => savingsRateByMonth(data, monthRange(srFromR, srToR), principalCap),
    [data, srFromR, srToR, principalCap],
  )
  const srStats = useMemo(() => {
    if (savingsRate.length === 0) return null
    const rates = savingsRate.map((p) => p.rate)
    return {
      max: Math.max(...rates),
      min: Math.min(...rates),
      avg: Math.round((rates.reduce((s, v) => s + v, 0) / rates.length) * 10) / 10,
    }
  }, [savingsRate])

  // カテゴリ別の集計（期間指定）
  const [statFromR, statToR] = rangeOf(statPreset, month, earliestMonth, statFrom, statTo)
  const stats = useMemo(() => categoryStats(data.expenses, monthRange(statFromR, statToR)), [data, statFromR, statToR])

  const composition = useMemo(
    () => expenseComposition(data, chartMonths.slice(-12), principalCap),
    [data, chartMonths, principalCap],
  )
  const fixedBreakdown = useMemo(() => fixedCostBreakdown(data.fixed_costs, month), [data, month])

  // ---- 消費量 ----
  const consumptionCats = useMemo(() => {
    const has = new Set((data.consumption ?? []).filter((c) => c.quantity > 0).map((c) => c.category))
    return Object.keys(CONSUMPTION_UNITS).filter((c) => has.has(c))
  }, [data])
  const qtyByCat = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const c of data.consumption ?? []) {
      if (!m.has(c.category)) m.set(c.category, new Map())
      m.get(c.category)!.set(c.month, c.quantity)
    }
    return m
  }, [data])

  // ---- 今月の収支・純資産・期間集計 ----
  const curIncome = incMap.get(month) ?? 0
  const curVariable = expMap.get(month) ?? 0
  const curFixed = fixedOf(month)
  const curBalance = curIncome - curVariable - curFixed
  const liabilityTotal = totalLiabilitiesAt(liabilities, month)
  const netWorthNow = (latest ? assetTotal(latest) : 0) - liabilityTotal

  const [from, to] = rangeOf(preset, month, earliestMonth, customFrom, customTo)
  const sum = useMemo(() => periodSummary(data, from, to, principalCap), [data, from, to, principalCap])
  const cumulative = useMemo(() => {
    let cin = 0
    let cout = 0
    return sum.months.map((m) => {
      const other = estimateOtherExpense(incMap.get(m) ?? 0, fixedOf(m), expMap.get(m) ?? 0, breakdown.get(m)?.delta) ?? 0
      cin += incMap.get(m) ?? 0
      cout += fixedOf(m) + (expMap.get(m) ?? 0) + other
      return { m, cin: Math.round(cin), cout: Math.round(cout) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sum, incMap, expMap, breakdown])
  const showLabels = cumulative.length <= 13

  const yenAxis = { y: { ticks: { callback: (v: unknown) => yenShort(Number(v)) } } }
  const lbl = (m: string) => m.slice(2)

  return (
    <>
      {/* ===================== 資産 ===================== */}
      <details open className="graph-section">
        <summary>📈 資産のグラフ</summary>

        <div className="card">
          <h2>総資産{latest ? `（${latest.date}時点）` : ''}</h2>
          {latest ? (
            <>
              <div className="big">{yen(assetTotal(latest))}</div>
              {prev && (
                <div className={assetTotal(latest) - assetTotal(prev) >= 0 ? 'pos' : 'neg'}>
                  前回比 {assetTotal(latest) - assetTotal(prev) >= 0 ? '+' : ''}
                  {yen(assetTotal(latest) - assetTotal(prev))}
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <div className="kv"><span className="muted">投資（マネフォ）</span><span>{yen(latest.investment)}</span></div>
                <div className="kv"><span className="muted">現金（Zaim）</span><span>{yen(latest.cash)}</span></div>
                <div className="kv"><span className="muted">年金</span><span>{yen(latest.pension)}</span></div>
                {latest.mf_profit !== null && (
                  <div className="kv"><span className="muted">評価損益（累計）</span>
                    <span className={latest.mf_profit >= 0 ? 'pos' : 'neg'}>{yen(latest.mf_profit)}</span></div>
                )}
                {latest.monthly_gain !== null && (
                  <div className="kv"><span className="muted">今月の投資増減</span>
                    <span className={latest.monthly_gain >= 0 ? 'pos' : 'neg'}>{latest.monthly_gain >= 0 ? '+' : ''}{yen(latest.monthly_gain)}</span></div>
                )}
              </div>
            </>
          ) : (
            <p className="muted">まだ記録がありません。「資産」タブから記録してください。</p>
          )}
        </div>

        {allocation.total > 0 && (
          <div className="card">
            <h2>資産配分（最新: {latest?.date}）</h2>
            <div className="chart-box small">
              <Doughnut
                data={{ labels: allocation.items.map((a) => a.label), datasets: [{ data: allocation.items.map((a) => a.value), backgroundColor: allocation.items.map((a) => a.color), borderColor: 'transparent' }] }}
                options={donutOpts(allocation.items)}
              />
            </div>
            <div style={{ marginTop: 6 }}>
              {allocation.items.map((a) => (
                <div className="kv" key={a.label}>
                  <span className="muted"><span style={{ color: a.color }}>■</span> {a.label}（{Math.round((a.value / allocation.total) * 100)}%）</span>
                  <span>{yen(a.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {assetRecent.length >= 2 && (
          <div className="card">
            <h2>資産推移（内訳）</h2>
            <div className="chart-box">
              <Line
                data={{
                  labels: assetRecent.map((a) => a.date.slice(2, 10)),
                  datasets: [
                    { label: '合計', data: assetRecent.map(assetTotal), borderColor: '#38bdf8', tension: 0.3, pointRadius: 0 },
                    { label: '投資', data: assetRecent.map((a) => a.investment), borderColor: '#4ade80', tension: 0.3, pointRadius: 0 },
                    { label: '現金', data: assetRecent.map((a) => a.cash), borderColor: '#fbbf24', tension: 0.3, pointRadius: 0 },
                    { label: '年金', data: assetRecent.map((a) => a.pension), borderColor: '#c084fc', tension: 0.3, pointRadius: 0 },
                  ],
                }}
                options={{ maintainAspectRatio: false, spanGaps: true, interaction: { mode: 'index', intersect: false }, scales: yenAxis }}
              />
            </div>
          </div>
        )}

        {allocTrend.length >= 2 && (
          <div className="card">
            <h2>資産配分の推移</h2>
            <div className="chart-box small">
              <Line
                data={{
                  labels: allocTrend.map((p) => lbl(p.month)),
                  datasets: [
                    { label: '投資', data: allocTrend.map((p) => p.investPct), borderColor: '#4ade80', tension: 0.3, pointRadius: 0 },
                    { label: '現金', data: allocTrend.map((p) => p.cashPct), borderColor: '#38bdf8', tension: 0.3, pointRadius: 0 },
                    { label: '年金', data: allocTrend.map((p) => p.pensionPct), borderColor: '#c084fc', tension: 0.3, pointRadius: 0 },
                  ],
                }}
                options={{
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  scales: { y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } }, x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } } },
                  plugins: { datalabels: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%` } } },
                }}
              />
            </div>
          </div>
        )}

        {(liabilities.length > 0 || totalLiabilitiesAt(liabilities, month) > 0) && netWorthSeries.length >= 2 && (
          <div className="card">
            <h2>純資産の推移</h2>
            <div className="chart-box small">
              <Line
                data={{
                  labels: netWorthSeries.map((p) => lbl(p.month)),
                  datasets: [
                    { label: '資産', data: netWorthSeries.map((p) => p.assets), borderColor: '#38bdf8', tension: 0.3, pointRadius: 0 },
                    { label: '負債', data: netWorthSeries.map((p) => -p.liabilities), borderColor: '#f87171', tension: 0.3, pointRadius: 0 },
                    { label: '純資産', data: netWorthSeries.map((p) => p.netWorth), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.12)', fill: true, tension: 0.3, pointRadius: 0 },
                  ],
                }}
                options={{ maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: yenAxis }}
              />
            </div>
          </div>
        )}

        {profits.length >= 2 && (
          <div className="card">
            <h2>評価損益（累計）の推移</h2>
            <div className="chart-box small">
              <Line
                data={{ labels: profits.map((a) => a.date.slice(2, 10)), datasets: [{ label: '評価損益', data: profits.map((a) => a.mf_profit), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.15)', fill: true, tension: 0.3 }] }}
                options={{ maintainAspectRatio: false, spanGaps: true, plugins: { legend: { display: false } }, scales: yenAxis }}
              />
            </div>
          </div>
        )}

        {gains.length >= 2 && (
          <div className="card">
            <h2>今月の投資増減の推移</h2>
            <div className="chart-box small">
              <Bar
                data={{ labels: gains.map(([m]) => lbl(m)), datasets: [{ label: '今月の投資増減', data: gains.map(([, v]) => v), backgroundColor: gains.map(([, v]) => (v >= 0 ? '#4ade80' : '#f87171')) }] }}
                options={{ maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: yenAxis }}
              />
            </div>
          </div>
        )}
      </details>

      {/* ===================== 収支 ===================== */}
      <details open className="graph-section">
        <summary>💰 収支のグラフ</summary>

        {(liabilities.length > 0 || liabilityTotal > 0) && (
          <div className="card">
            <h2>
              純資産（バランスシート）
              <HelpTip title="純資産の計算">
                純資産 = 資産合計 − 負債合計。負債は「資産」タブで登録でき、ローンは元利均等の返済スケジュールから
                各時点の残高を自動計算します（実測を入れた場合はそちらを優先）。推移グラフは「資産のグラフ」内にあります。
              </HelpTip>
            </h2>
            <div className="kv"><span className="muted">資産合計</span><span>{yen(latest ? assetTotal(latest) : 0)}</span></div>
            <div className="kv"><span className="muted">負債合計</span><span className="neg">−{yen(liabilityTotal)}</span></div>
            <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
              <span>純資産</span>
              <b className={netWorthNow >= 0 ? 'pos' : 'neg'}>{yen(netWorthNow)}</b>
            </div>
          </div>
        )}

        <div className="card">
          <h2>今月の収支（{month}）</h2>
          <div className="kv"><span className="muted">収入</span><span>{yen(curIncome)}</span></div>
          <div className="kv"><span className="muted">変動費</span><span>{yen(curVariable)}</span></div>
          <div className="kv"><span className="muted">固定費（月割り）</span><span>{yen(curFixed)}</span></div>
          <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
            <span>収支</span>
            <span className={curBalance >= 0 ? 'pos' : 'neg'}>{curBalance >= 0 ? '+' : ''}{yen(curBalance)}</span>
          </div>
        </div>

        <div className="card">
          <h2>
            期間集計（{from} 〜 {to}・{sum.months.length}ヶ月）
            <HelpTip title="期間集計の定義">
              ・収入合計: 各月の実効収入（給与明細の手取り＋その他収入）
              {'\n'}・固定費: 固定費タブの月割り額の合計
              {'\n'}・変動費: 収支入力の合計
              {'\n'}・その他支出: 収支タブと同じ推計（資産記録から算出できた月のみ合算）
              {'\n'}・収支合計 = 収入 − (固定費+変動費+その他)
              {'\n'}・期間の資産増減: 期間開始前月末と期間末の資産スナップショットの差（投資の値動き込み）
            </HelpTip>
          </h2>
          <div className="seg">
            {([['year', '今年'], ['12m', '過去12ヶ月'], ['all', '全期間'], ['custom', '期間指定']] as [Preset, string][]).map(([p, label]) => (
              <button key={p} className={preset === p ? 'on' : ''} onClick={() => setPreset(p)}>{label}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="row2">
              <label className="field">開始月
                <input type="month" value={customFrom || earliestMonth} onChange={(e) => setCustomFrom(e.target.value)} /></label>
              <label className="field">終了月
                <input type="month" value={customTo || month} onChange={(e) => setCustomTo(e.target.value)} /></label>
            </div>
          )}
          <div className="kv"><span className="muted">収入合計（手取り）</span><b className="pos">{yen(sum.income)}</b></div>
          <div className="kv"><span className="muted">支出合計</span><b className="neg">{yen(sum.expense)}</b></div>
          <div className="kv" style={{ paddingLeft: 12 }}><span className="muted">　固定費</span><span>{yen(sum.fixed)}</span></div>
          <div className="kv" style={{ paddingLeft: 12 }}><span className="muted">　変動費</span><span>{yen(sum.variable)}</span></div>
          <div className="kv" style={{ paddingLeft: 12 }}>
            <span className="muted">　その他支出（{sum.otherMonths}/{sum.months.length}ヶ月分）</span>
            <span>{yen(sum.other)}</span>
          </div>
          <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
            <span>収支合計</span>
            <span className={sum.balance >= 0 ? 'pos' : 'neg'}>{sum.balance >= 0 ? '+' : ''}{yen(sum.balance)}</span>
          </div>
          {sum.assetDelta !== null && (
            <div className="kv">
              <span className="muted">期間の資産増減（値動き込み）</span>
              <span className={sum.assetDelta >= 0 ? 'pos' : 'neg'}>{sum.assetDelta >= 0 ? '+' : ''}{yen(sum.assetDelta)}</span>
            </div>
          )}
          {cumulative.length >= 2 && (
            <div className="chart-box" style={{ marginTop: 10 }}>
              <Line
                data={{
                  labels: cumulative.map((r) => lbl(r.m)),
                  datasets: [
                    { label: '累積収入', data: cumulative.map((r) => r.cin), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.12)', fill: true, tension: 0.2 },
                    { label: '累積支出', data: cumulative.map((r) => r.cout), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.10)', fill: true, tension: 0.2 },
                    { label: '累積収支', data: cumulative.map((r) => r.cin - r.cout), borderColor: '#38bdf8', borderDash: [6, 4], tension: 0.2 },
                  ],
                }}
                options={{
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  scales: { y: { ticks: { callback: (v) => yenShort(Number(v)) } }, x: { ticks: { maxTicksLimit: 9, maxRotation: 0 } } },
                  plugins: {
                    datalabels: {
                      display: (ctx) => showLabels || ctx.dataIndex === cumulative.length - 1 || ctx.dataIndex % Math.ceil(cumulative.length / 6) === 0,
                      align: 'top', color: '#94a3b8', font: { size: 9 }, formatter: (v: number) => yenShort(v),
                    },
                  },
                }}
              />
            </div>
          )}
        </div>

        {chartMonths.length >= 2 && (
          <>
          <div className="card">
            <h2>収入 vs 全支出（投資除く）</h2>
            <div className="chart-box">
              <Chart
                type="bar"
                data={{
                  labels: chartMonths.map(lbl),
                  datasets: [
                    { type: 'bar' as const, label: '収入', data: chartMonths.map((m) => incMap.get(m) ?? 0), backgroundColor: '#4ade80', stack: 'in' },
                    { type: 'bar' as const, label: '固定費', data: chartMonths.map((m) => -fixedOf(m)), backgroundColor: '#fb923c', stack: 'out' },
                    { type: 'bar' as const, label: '変動費', data: chartMonths.map((m) => -(expMap.get(m) ?? 0)), backgroundColor: '#f87171', stack: 'out' },
                    { type: 'bar' as const, label: 'その他支出', data: chartMonths.map((m) => { const o = otherOf(m); return o === null ? null : -o }), backgroundColor: '#c084fc', stack: 'out' },
                    { type: 'line' as const, label: '収支', data: chartMonths.map((m) => (incMap.get(m) ?? 0) - totalExp(m)), borderColor: '#38bdf8', tension: 0.3, stack: 'balance' },
                  ],
                }}
                options={{ maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => yenShort(Number(v)) } } } }}
              />
            </div>
          </div>

          <div className="card">
            <h2>
              貯蓄率の推移
              <HelpTip title="貯蓄率">その月の (収入 − 支出) ÷ 収入 × 100 です。支出は固定費＋変動費＋その他支出。プラスが大きいほど収入のうち多くを貯蓄・投資に回せています（マイナスは赤字）。<br />最大・平均・最小は選んだ期間の各月の貯蓄率から算出（平均は各月％の単純平均）。収入0の月は除外します。</HelpTip>
            </h2>
            <div className="seg">
              {PRESETS.map(([p, label]) => (
                <button key={p} className={srPreset === p ? 'on' : ''} onClick={() => setSrPreset(p)}>{label}</button>
              ))}
            </div>
            {srPreset === 'custom' && (
              <div className="row2">
                <label className="field">開始月
                  <input type="month" value={srFrom || earliestMonth} onChange={(e) => setSrFrom(e.target.value)} /></label>
                <label className="field">終了月
                  <input type="month" value={srTo || month} onChange={(e) => setSrTo(e.target.value)} /></label>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>{srFromR} 〜 {srToR}</p>
            {srStats ? (
              <>
                <div className="kv"><span className="muted">最大</span><b className="pos">{srStats.max}%</b></div>
                <div className="kv"><span className="muted">平均</span><b>{srStats.avg}%</b></div>
                <div className="kv"><span className="muted">最小</span><b className={srStats.min < 0 ? 'neg' : ''}>{srStats.min}%</b></div>
                <div className="chart-box small" style={{ marginTop: 8 }}>
                  <Bar
                    data={{ labels: savingsRate.map((p) => lbl(p.month)), datasets: [{ label: '貯蓄率', data: savingsRate.map((p) => p.rate), backgroundColor: savingsRate.map((p) => (p.rate >= 0 ? '#4ade80' : '#f87171')) }] }}
                    options={{ maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `貯蓄率: ${ctx.parsed.y}%` } } }, scales: { y: { ticks: { callback: (v) => `${v}%` } } } }}
                  />
                </div>
              </>
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>この期間に収入のある月がありません</p>
            )}
          </div>

          {composition.length > 0 && (
            <div className="card">
              <h2>
                支出のカテゴリ構成比
                <HelpTip title="支出構成比">直近12ヶ月の支出の内訳（固定費・変動費カテゴリ別・その他支出）の割合です。何にお金がかかっているかを把握できます。</HelpTip>
              </h2>
              <div className="chart-box small">
                <Doughnut
                  data={{ labels: composition.map((c) => c.label), datasets: [{ data: composition.map((c) => c.value), backgroundColor: composition.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: 'transparent' }] }}
                  options={donutOpts(composition)}
                />
              </div>
            </div>
          )}

          {fixedBreakdown.length > 0 && (
            <div className="card">
              <h2>
                固定費の内訳（月割り）
                <HelpTip title="固定費の内訳">固定費タブに登録した各項目の月割り額（年払い・2年払いは月換算）の内訳です。</HelpTip>
              </h2>
              <div className="chart-box small">
                <Doughnut
                  data={{ labels: fixedBreakdown.map((f) => f.name), datasets: [{ data: fixedBreakdown.map((f) => f.monthly), backgroundColor: fixedBreakdown.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: 'transparent' }] }}
                  options={donutOpts(fixedBreakdown.map((f) => ({ value: f.monthly })))}
                />
              </div>
            </div>
          )}

          <div className="card">
            <h2>変動費カテゴリ別の推移</h2>
            <div className="chart-box">
              <Line
                data={{ labels: chartMonths.map(lbl), datasets: [...catTrend.entries()].map(([cat, map], i) => ({ label: cat, data: chartMonths.map((m) => map.get(m) ?? null), borderColor: PALETTE[i % PALETTE.length], tension: 0.3 })) }}
                options={{ maintainAspectRatio: false, spanGaps: true, interaction: { mode: 'index', intersect: false }, scales: yenAxis }}
              />
            </div>
          </div>

          <div className="card">
            <h2>
              カテゴリ別の集計（期間指定）
              <HelpTip title="カテゴリ別の集計">
                指定した期間の変動費カテゴリごとに、合計・平均・最大・最小・記録した月数を表示します。
                平均は「記録のある月」で割った値です（金額を入れなかった月は分母に含みません）。
              </HelpTip>
            </h2>
            <div className="seg">
              {PRESETS.map(([p, label]) => (
                <button key={p} className={statPreset === p ? 'on' : ''} onClick={() => setStatPreset(p)}>{label}</button>
              ))}
            </div>
            {statPreset === 'custom' && (
              <div className="row2">
                <label className="field">開始月
                  <input type="month" value={statFrom || earliestMonth} onChange={(e) => setStatFrom(e.target.value)} /></label>
                <label className="field">終了月
                  <input type="month" value={statTo || month} onChange={(e) => setStatTo(e.target.value)} /></label>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>{statFromR} 〜 {statToR}</p>
            {stats.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>この期間に変動費の記録がありません</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: 12, borderCollapse: 'collapse', whiteSpace: 'nowrap', width: '100%' }}>
                  <thead>
                    <tr className="muted">
                      <th style={{ padding: 4, textAlign: 'left' }}>カテゴリ</th>
                      <th style={{ padding: 4, textAlign: 'right' }}>合計</th>
                      <th style={{ padding: 4, textAlign: 'right' }}>平均</th>
                      <th style={{ padding: 4, textAlign: 'right' }}>最大</th>
                      <th style={{ padding: 4, textAlign: 'right' }}>最小</th>
                      <th style={{ padding: 4, textAlign: 'right' }}>月数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((s) => (
                      <tr key={s.category} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: 4 }}>{s.category}</td>
                        <td style={{ padding: 4, textAlign: 'right' }}>{yen(s.total)}</td>
                        <td style={{ padding: 4, textAlign: 'right' }}>{yen(s.avg)}</td>
                        <td style={{ padding: 4, textAlign: 'right' }}>{yen(s.max)}</td>
                        <td style={{ padding: 4, textAlign: 'right' }}>{yen(s.min)}</td>
                        <td style={{ padding: 4, textAlign: 'right' }}>{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>
        )}
      </details>

      {/* ===================== 消費量 ===================== */}
      {consumptionCats.length > 0 && chartMonths.length >= 2 && (
        <details open className="graph-section">
          <summary>⚡ 消費量のグラフ</summary>

          <div className="card">
            <h2>消費量の推移</h2>
            <div className="chart-box">
              <Line
                data={{ labels: chartMonths.map(lbl), datasets: consumptionCats.map((cat, i) => ({ label: `${cat}(${CONSUMPTION_UNITS[cat]})`, data: chartMonths.map((m) => qtyByCat.get(cat)?.get(m) ?? null), borderColor: PALETTE[i % PALETTE.length], tension: 0.3 })) }}
                options={{ maintainAspectRatio: false, spanGaps: true, interaction: { mode: 'index', intersect: false } }}
              />
            </div>
          </div>

          <div className="card">
            <h2>単価の推移（円/単位）</h2>
            <div className="chart-box">
              <Line
                data={{
                  labels: chartMonths.map(lbl),
                  datasets: consumptionCats.map((cat, i) => ({
                    label: `${cat}(円/${CONSUMPTION_UNITS[cat]})`,
                    data: chartMonths.map((m) => {
                      const q = qtyByCat.get(cat)?.get(m)
                      const amount = data.expenses.find((e) => e.month === m && e.category === cat)?.amount
                      return q && q > 0 && amount ? Math.round((amount / q) * 10) / 10 : null
                    }),
                    borderColor: PALETTE[i % PALETTE.length],
                    tension: 0.3,
                  })),
                }}
                options={{ maintainAspectRatio: false, spanGaps: true, interaction: { mode: 'index', intersect: false } }}
              />
            </div>
          </div>
        </details>
      )}
    </>
  )
}
