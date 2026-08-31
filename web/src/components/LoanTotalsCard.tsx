import { Bar } from 'react-chartjs-2'
import HelpTip from './HelpTip'
import type { LiabilityRow } from '../types'
import { loanTotals, yen, yenShort } from '../utils'

/**
 * ローンの「当初借入額に対して最終的にいくら払うか」を示すカード。
 * 資産タブ（負債カードの下）とホームの資産セクションで共用する。
 */
export default function LoanTotalsCard({ liabilities }: { liabilities: LiabilityRow[] }) {
  const rows = liabilities
    .map((l) => ({ l, t: loanTotals(l) }))
    .filter((r): r is { l: LiabilityRow; t: NonNullable<ReturnType<typeof loanTotals>> } => r.t !== null)
  if (rows.length === 0) return null

  const sum = rows.reduce(
    (s, r) => ({ principal: s.principal + r.t.principal, total: s.total + r.t.total, interest: s.interest + r.t.interest }),
    { principal: 0, total: 0, interest: 0 },
  )

  return (
    <div className="card">
      <h2>
        ローンの総支払額（元金＋利息）
        <HelpTip title="総支払額の計算">
          当初借入額・金利・返済年数から、元利均等・固定金利で完済までに支払う総額を試算します。
          {'\n'}総支払額 = 毎月返済額 × 返済回数（年数×12）、利息総額 = 総支払額 − 当初借入額。
          {'\n'}各項目: 当初借入=借りた元金、利息=完済までに上乗せで払う利息の総額（「元金の+○%」は元金に対する割合）、毎月返済=毎月の返済額、支払済/残り=これまでに払った額とこれから払う額（カッコ内は返済回数）。
          ※当初の借入条件どおりに返した場合の金額です。繰上返済（現在残高の実測）や金利変動は反映していません。
        </HelpTip>
      </h2>

      {rows.map(({ l, t }) => (
        <div key={l.id} style={{ marginBottom: 12 }}>
          <div className="kv">
            <span>
              {l.name}
              <span className="muted" style={{ fontSize: 11 }}> {l.rate ?? 0}%・{l.years ?? 0}年{t.endMonth ? `・${t.endMonth}完済` : ''}</span>
            </span>
            <b>{yen(t.total)}</b>
          </div>
          <div className="stat-grid" style={{ marginTop: 6 }}>
            <div className="stat">
              <span className="k">当初借入</span>
              <span className="v">{yen(t.principal)}</span>
            </div>
            <div className="stat">
              <span className="k">利息</span>
              <span className="v">
                <span className="neg">+{yen(t.interest)}</span>
                <span className="d neg">元金の+{Math.round((t.interest / t.principal) * 1000) / 10}%</span>
              </span>
            </div>
            <div className="stat">
              <span className="k">毎月返済</span>
              <span className="v">{yen(t.monthly)}</span>
            </div>
            {t.endMonth && (
              <>
                <div className="stat">
                  <span className="k">支払済</span>
                  <span className="v">{yen(t.paid)}<span className="d">{t.paidMonths}/{t.months}回</span></span>
                </div>
                <div className="stat">
                  <span className="k">残り</span>
                  <span className="v">{yen(t.remaining)}<span className="d">あと{t.months - t.paidMonths}回</span></span>
                </div>
              </>
            )}
          </div>
        </div>
      ))}

      {rows.length > 1 && (
        <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
          <span>合計（当初 {yen(sum.principal)}）</span>
          <b>{yen(sum.total)}</b>
        </div>
      )}

      <div className="chart-box small" style={{ marginTop: 8 }}>
        <Bar
          data={{
            labels: rows.map((r) => r.l.name),
            datasets: [
              { label: '元金', data: rows.map((r) => Math.round(r.t.principal)), backgroundColor: '#38bdf8', stack: 'pay' },
              { label: '利息', data: rows.map((r) => Math.round(r.t.interest)), backgroundColor: '#f87171', stack: 'pay' },
            ],
          }}
          options={{
            indexAxis: 'y' as const,
            maintainAspectRatio: false,
            // 横棒なので判定軸も y にする（既定の x のままだとタップした行が無視される）
            interaction: { mode: 'index', intersect: false, axis: 'y' },
            scales: { x: { stacked: true, ticks: { callback: (v) => yenShort(Number(v)) } }, y: { stacked: true } },
            plugins: { datalabels: { display: false } },
          }}
        />
      </div>
      <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
        バーの長さが完済までの総支払額（青=元金／赤=利息）。当初の借入条件どおりに返した場合の試算です
      </p>
    </div>
  )
}
