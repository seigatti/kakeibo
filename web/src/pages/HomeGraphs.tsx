import { useMemo } from 'react'
import { Bar, Chart, Doughnut, Line } from 'react-chartjs-2'
import HelpTip from '../components/HelpTip'
import { CONSUMPTION_UNITS, type AllData } from '../types'
import {
  assetAllocationTrend,
  assetTotal,
  DEFAULT_PRINCIPAL_CAP,
  dataMonthRange,
  effectiveIncomeByMonth,
  estimateOtherExpense,
  expenseByMonth,
  expenseComposition,
  fixedCostBreakdown,
  fixedMonthlyTotal,
  netSalaryByMonth,
  netWorthByMonth,
  nonInvestBreakdownByMonth,
  savingsRateByMonth,
  sortedAssets,
  thisMonth,
  totalLiabilitiesAt,
  yen,
  yenShort,
} from '../utils'

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
  const months = useMemo(() => dataMonthRange(data.expenses, data.income, [...netByMonth.keys()]), [data, netByMonth])
  const chartMonths = months.slice(-24)
  const incMap = useMemo(() => effectiveIncomeByMonth(data.income, data.furusato_salaries ?? []), [data])
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

  const savingsRate = useMemo(() => savingsRateByMonth(data, chartMonths, principalCap), [data, chartMonths, principalCap])
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

  const yenAxis = { y: { ticks: { callback: (v: unknown) => yenShort(Number(v)) } } }
  const lbl = (m: string) => m.slice(2)

  return (
    <>
      {/* ===================== 資産 ===================== */}
      <details open className="graph-section">
        <summary>📈 資産のグラフ</summary>

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
      {chartMonths.length >= 2 && (
        <details className="graph-section">
          <summary>💰 収支のグラフ</summary>

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

          {savingsRate.length >= 2 && (
            <div className="card">
              <h2>
                貯蓄率の推移
                <HelpTip title="貯蓄率">その月の (収入 − 支出) ÷ 収入 × 100 です。支出は固定費＋変動費＋その他支出。プラスが大きいほど収入のうち多くを貯蓄・投資に回せています（マイナスは赤字）。</HelpTip>
              </h2>
              <div className="chart-box small">
                <Bar
                  data={{ labels: savingsRate.map((p) => lbl(p.month)), datasets: [{ label: '貯蓄率', data: savingsRate.map((p) => p.rate), backgroundColor: savingsRate.map((p) => (p.rate >= 0 ? '#4ade80' : '#f87171')) }] }}
                  options={{ maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `貯蓄率: ${ctx.parsed.y}%` } } }, scales: { y: { ticks: { callback: (v) => `${v}%` } } } }}
                />
              </div>
            </div>
          )}

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
        </details>
      )}

      {/* ===================== 消費量 ===================== */}
      {consumptionCats.length > 0 && chartMonths.length >= 2 && (
        <details className="graph-section">
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
