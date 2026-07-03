import { Line } from 'react-chartjs-2'
import { useStore } from '../store'
import { assetTotal, expenseByMonth, fixedMonthlyTotal, incomeByMonth, sortedAssets, thisMonth, yen, yenShort } from '../utils'

export default function Dashboard() {
  const { data } = useStore()
  if (!data) return null

  const assets = sortedAssets(data.assets)
  const latest = assets[assets.length - 1]
  const prev = assets[assets.length - 2]
  const month = thisMonth()

  const income = incomeByMonth(data.income).get(month) ?? 0
  const variable = expenseByMonth(data.expenses).get(month) ?? 0
  const fixed = fixedMonthlyTotal(data.fixed_costs, month)
  const balance = income - variable - fixed

  const recent = assets.slice(-13)

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
