import { useMemo, useState } from 'react'
import { Doughnut, Line } from 'react-chartjs-2'
import HelpTip from '../components/HelpTip'
import { useStore } from '../store'
import {
  addMonths,
  assetTotal,
  DEFAULT_PRINCIPAL_CAP,
  effectiveIncomeByMonth,
  estimateOtherExpense,
  expenseByMonth,
  fixedMonthlyTotal,
  netSalaryByMonth,
  netWorthByMonth,
  nonInvestBreakdownByMonth,
  periodSummary,
  sortedAssets,
  thisMonth,
  totalLiabilitiesAt,
  yen,
  yenShort,
} from '../utils'

type Preset = 'year' | '12m' | 'all' | 'custom'

export default function Dashboard() {
  const { data } = useStore()
  const month = thisMonth()
  const [preset, setPreset] = useState<Preset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // データが存在する最古の月（収入・変動費・給与データから）
  const earliestMonth = useMemo(() => {
    if (!data) return month
    const months = [
      ...data.income.map((i) => i.month),
      ...data.expenses.map((e) => e.month),
      ...netSalaryByMonth(data.furusato_salaries ?? []).keys(),
    ]
    return months.length ? months.sort()[0] : month
  }, [data, month])

  const [from, to] = useMemo((): [string, string] => {
    if (preset === 'year') return [`${month.slice(0, 4)}-01`, month]
    if (preset === '12m') return [addMonths(month, -11), month]
    if (preset === 'custom' && customFrom && customTo) return [customFrom, customTo]
    return [earliestMonth, month]
  }, [preset, customFrom, customTo, earliestMonth, month])

  const principalCap = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'principal_cap')?.value
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PRINCIPAL_CAP
  }, [data])

  const sum = useMemo(() => (data ? periodSummary(data, from, to, principalCap) : null), [data, from, to, principalCap])

  // 累積グラフ用の系列
  const cumulative = useMemo(() => {
    if (!data || !sum) return null
    const incMap = effectiveIncomeByMonth(data.income, data.furusato_salaries ?? [])
    const expMap = expenseByMonth(data.expenses)
    const breakdown = nonInvestBreakdownByMonth(data.assets, principalCap)
    let cin = 0
    let cout = 0
    const rows = sum.months.map((m) => {
      const fixed = fixedMonthlyTotal(data.fixed_costs, m)
      const other = estimateOtherExpense(incMap.get(m) ?? 0, fixed, expMap.get(m) ?? 0, breakdown.get(m)?.delta) ?? 0
      cin += incMap.get(m) ?? 0
      cout += fixed + (expMap.get(m) ?? 0) + other
      return { m, cin: Math.round(cin), cout: Math.round(cout) }
    })
    return rows
  }, [data, sum, principalCap])

  if (!data || !sum) return null

  const assets = sortedAssets(data.assets)
  const latest = assets[assets.length - 1]
  const prev = assets[assets.length - 2]

  const income = effectiveIncomeByMonth(data.income, data.furusato_salaries ?? []).get(month) ?? 0
  const variable = expenseByMonth(data.expenses).get(month) ?? 0
  const fixed = fixedMonthlyTotal(data.fixed_costs, month)
  const balance = income - variable - fixed

  const recent = assets.slice(-13)
  const showLabels = (cumulative?.length ?? 0) <= 13 // 1年以内の表示なら各点に値ラベル

  // 資産配分（最新スナップショットの内訳）
  const allocation = (() => {
    const items = [
      { label: '投資', value: latest?.investment ?? 0, color: '#4ade80' },
      { label: '現金', value: latest?.cash ?? 0, color: '#38bdf8' },
      { label: '年金', value: latest?.pension ?? 0, color: '#c084fc' },
    ].filter((a) => a.value > 0)
    return { items, total: items.reduce((s, a) => s + a.value, 0) }
  })()

  // 負債・純資産
  const liabilities = data.liabilities ?? []
  const liabilityTotal = totalLiabilitiesAt(liabilities, month)
  const netWorthNow = (latest ? assetTotal(latest) : 0) - liabilityTotal
  const netWorthSeries = netWorthByMonth(data.assets, liabilities).slice(-24)

  return (
    <>
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
                <div className="kv"><span className="muted">評価損益</span>
                  <span className={latest.mf_profit >= 0 ? 'pos' : 'neg'}>{yen(latest.mf_profit)}</span></div>
              )}
            </div>
          </>
        ) : (
          <p className="muted">まだ記録がありません。「資産」タブから記録してください。</p>
        )}
      </div>

      {latest && allocation.total > 0 && (
        <div className="card">
          <h2>
            資産配分
            <HelpTip title="資産配分">
              最新の資産記録（{latest.date}）の内訳です。投資・現金・年金の構成比を表示します。
              現金の比率が高すぎないか、投資に偏りすぎていないかの確認に使えます。
            </HelpTip>
          </h2>
          <div className="chart-box small">
            <Doughnut
              data={{
                labels: allocation.items.map((a) => a.label),
                datasets: [{
                  data: allocation.items.map((a) => a.value),
                  backgroundColor: allocation.items.map((a) => a.color),
                  borderColor: 'transparent',
                }],
              }}
              options={{
                maintainAspectRatio: false,
                cutout: '58%',
                plugins: {
                  legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
                  datalabels: {
                    display: true,
                    color: '#0f172a',
                    font: { size: 11, weight: 'bold' },
                    formatter: (v: number) => `${Math.round((v / allocation.total) * 100)}%`,
                  },
                },
              }}
            />
          </div>
          <div style={{ marginTop: 6 }}>
            {allocation.items.map((a) => (
              <div className="kv" key={a.label}>
                <span className="muted">
                  <span style={{ color: a.color }}>■</span> {a.label}（{Math.round((a.value / allocation.total) * 100)}%）
                </span>
                <span>{yen(a.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(liabilities.length > 0 || liabilityTotal > 0) && (
        <div className="card">
          <h2>
            純資産（バランスシート）
            <HelpTip title="純資産の計算">
              純資産 = 資産合計 − 負債合計。負債は「資産」タブで登録でき、ローンは元利均等の返済スケジュールから
              各時点の残高を自動計算します（実測を入れた場合はそちらを優先）。グラフは資産記録がある月ごとの推移です。
            </HelpTip>
          </h2>
          <div className="kv"><span className="muted">資産合計</span><span>{yen(latest ? assetTotal(latest) : 0)}</span></div>
          <div className="kv"><span className="muted">負債合計</span><span className="neg">−{yen(liabilityTotal)}</span></div>
          <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
            <span>純資産</span>
            <b className={netWorthNow >= 0 ? 'pos' : 'neg'}>{yen(netWorthNow)}</b>
          </div>
          {netWorthSeries.length >= 2 && (
            <div className="chart-box small" style={{ marginTop: 8 }}>
              <Line
                data={{
                  labels: netWorthSeries.map((p) => p.month.slice(2)),
                  datasets: [
                    { label: '資産', data: netWorthSeries.map((p) => p.assets), borderColor: '#38bdf8', tension: 0.3, pointRadius: 0 },
                    { label: '負債', data: netWorthSeries.map((p) => -p.liabilities), borderColor: '#f87171', tension: 0.3, pointRadius: 0 },
                    { label: '純資産', data: netWorthSeries.map((p) => p.netWorth), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.12)', fill: true, tension: 0.3, pointRadius: 0 },
                  ],
                }}
                options={{
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  scales: { y: { ticks: { callback: (v) => yenShort(Number(v)) } }, x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } } },
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>今月の収支（{month}）</h2>
        <div className="kv"><span className="muted">収入</span><span>{yen(income)}</span></div>
        <div className="kv"><span className="muted">変動費</span><span>{yen(variable)}</span></div>
        <div className="kv"><span className="muted">固定費（月割り）</span><span>{yen(fixed)}</span></div>
        <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
          <span>収支</span>
          <span className={balance >= 0 ? 'pos' : 'neg'}>{balance >= 0 ? '+' : ''}{yen(balance)}</span>
        </div>
      </div>

      <div className="card">
        <h2>
          期間集計（{from} 〜 {to}・{sum.months.length}ヶ月）
          <HelpTip title="期間集計の定義">
            ・収入合計: 各月の実効収入（給料の手入力が優先。未入力月は給与データの手取り＋その他収入）
            {'\n'}・固定費: 固定費タブの月割り額の合計
            {'\n'}・変動費: 収支入力の合計
            {'\n'}・その他支出: 収支タブと同じ推計（資産記録から算出できた月のみ合算。何ヶ月分かは内訳に表示）
            {'\n'}・収支合計 = 収入 − (固定費+変動費+その他)
            {'\n'}・期間の資産増減: 期間開始前月末と期間末の資産スナップショットの差（投資の値動き込みの実額）
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

        {cumulative && cumulative.length >= 2 && (
          <div className="chart-box" style={{ marginTop: 10 }}>
            <Line
              data={{
                labels: cumulative.map((r) => r.m.slice(2)),
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
                    display: (ctx) =>
                      showLabels || ctx.dataIndex === (cumulative.length - 1) || ctx.dataIndex % Math.ceil(cumulative.length / 6) === 0,
                    align: 'top',
                    color: '#94a3b8',
                    font: { size: 9 },
                    formatter: (v: number) => yenShort(v),
                  },
                },
              }}
            />
          </div>
        )}
        <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
          点の上の数値は各月時点の累積額（表示期間が長いときは間引き表示）。その他支出は算出できた月のみ含みます
        </p>
      </div>

      {recent.length >= 2 && (
        <div className="card">
          <h2>資産推移（直近）</h2>
          <div className="chart-box small">
            <Line
              data={{
                labels: recent.map((a) => a.date.slice(2, 7)),
                datasets: [
                  {
                    label: '合計',
                    data: recent.map(assetTotal),
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.15)',
                    fill: true,
                    tension: 0.3,
                  },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { ticks: { callback: (v) => yenShort(Number(v)) } } },
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}
