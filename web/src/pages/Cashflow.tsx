import { useEffect, useMemo, useState } from 'react'
import { Bar, Chart, Line } from 'react-chartjs-2'
import { useStore } from '../store'
import { DEFAULT_CATEGORIES } from '../types'
import { addMonths, dataMonthRange, expenseByMonth, fixedMonthlyTotal, incomeByMonth, thisMonth, yen, yenShort } from '../utils'
import CsvImportCard from './CsvImportCard'

const PALETTE = ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#fb923c', '#2dd4bf', '#a3e635']

export default function Cashflow() {
  const { data, mutate, saving } = useStore()
  const [month, setMonth] = useState(thisMonth())
  const [salary, setSalary] = useState('')
  const [other, setOther] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [newCat, setNewCat] = useState('')
  const [extraCats, setExtraCats] = useState<string[]>([])
  const [msg, setMsg] = useState('')

  const categories = useMemo(() => {
    const fromSettings = data?.settings.find((s) => s.key === 'expense_categories')?.value
    const base = fromSettings ? fromSettings.split(',') : DEFAULT_CATEGORIES
    const inData = [...new Set((data?.expenses ?? []).map((e) => e.category))]
    return [...new Set([...base, ...inData, ...extraCats])]
  }, [data, extraCats])

  // 月を切り替えたら既存データをフォームへ反映
  useEffect(() => {
    if (!data) return
    const inc = data.income.find((i) => i.month === month)
    setSalary(inc?.salary?.toString() ?? '')
    setOther(inc?.other?.toString() ?? '')
    const map: Record<string, string> = {}
    for (const e of data.expenses.filter((e) => e.month === month)) map[e.category] = String(e.amount)
    setAmounts(map)
  }, [data, month])

  const num = (s: string | undefined) => (!s || s.trim() === '' ? null : Number(s.replace(/[,，]/g, '')))

  // 前月コピー: 対象月が未入力のとき、前月の給料・変動費をフォームへ充填
  const prevMonth = addMonths(month, -1)
  const prevIncome = data?.income.find((i) => i.month === prevMonth)
  const prevExpenses = useMemo(() => data?.expenses.filter((e) => e.month === prevMonth) ?? [], [data, prevMonth])
  const monthIsEmpty =
    !data?.income.some((i) => i.month === month) && !data?.expenses.some((e) => e.month === month)
  const copyPrevMonth = () => {
    setSalary(prevIncome?.salary?.toString() ?? '')
    setOther(prevIncome?.other?.toString() ?? '')
    const map: Record<string, string> = {}
    for (const e of prevExpenses) map[e.category] = String(e.amount)
    setAmounts(map)
    setMsg('')
  }

  const save = async () => {
    setMsg('')
    await mutate('setMonthData', {
      income: { month, salary: num(salary), other: num(other), memo: null },
      expenses: categories.map((c) => ({ month, category: c, amount: num(amounts[c]) })),
    })
    setMsg(`${month} の収支を保存しました`)
  }

  // ---- グラフ用集計 ----
  const months = useMemo(() => (data ? dataMonthRange(data.expenses, data.income) : []), [data])
  const chartMonths = months.slice(-24)
  const expMap = useMemo(() => expenseByMonth(data?.expenses ?? []), [data])
  const incMap = useMemo(() => incomeByMonth(data?.income ?? []), [data])
  const fixedOf = (m: string) => fixedMonthlyTotal(data?.fixed_costs ?? [], m)

  const catTrend = useMemo(() => {
    const byCat = new Map<string, Map<string, number>>()
    for (const e of data?.expenses ?? []) {
      if (!byCat.has(e.category)) byCat.set(e.category, new Map())
      byCat.get(e.category)!.set(e.month, e.amount)
    }
    return byCat
  }, [data])

  const total = (m: string) => (expMap.get(m) ?? 0) + fixedOf(m)

  return (
    <>
      <div className="card">
        <h2>収支入力（過去月もOK）</h2>
        <label className="field">対象月<input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setMsg('') }} /></label>
        {monthIsEmpty && (prevIncome || prevExpenses.length > 0) && (
          <button className="btn secondary" style={{ marginBottom: 10 }} onClick={copyPrevMonth}>
            前月（{prevMonth}）の値をコピー
          </button>
        )}
        <div className="row2">
          <label className="field">給料（収入）
            <input type="text" inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)}
              placeholder={prevIncome?.salary ? `前月: ${prevIncome.salary}` : undefined} /></label>
          <label className="field">その他収入
            <input type="text" inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value)} /></label>
        </div>
        <h2 style={{ marginTop: 6 }}>変動費</h2>
        <div className="row2">
          {categories.map((c) => (
            <label className="field" key={c}>{c}
              <input type="text" inputMode="numeric" value={amounts[c] ?? ''}
                onChange={(e) => setAmounts({ ...amounts, [c]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="row2" style={{ alignItems: 'end', marginBottom: 10 }}>
          <label className="field" style={{ marginBottom: 0 }}>カテゴリ追加
            <input type="text" placeholder="例: 食費" value={newCat} onChange={(e) => setNewCat(e.target.value)} /></label>
          <button className="btn secondary" onClick={() => { if (newCat.trim()) { setExtraCats([...extraCats, newCat.trim()]); setNewCat('') } }}>追加</button>
        </div>
        <button className="btn" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          ※支出合計には固定費の月割り（{yen(fixedOf(month))}）が自動で加算されます
        </p>
      </div>

      <CsvImportCard categories={categories} />

      {chartMonths.length >= 2 && (
        <>
          <div className="card">
            <h2>収入 vs 支出（変動費＋固定費月割り）</h2>
            <div className="chart-box">
              <Chart
                type="bar"
                data={{
                  labels: chartMonths.map((m) => m.slice(2)),
                  datasets: [
                    { type: 'bar' as const, label: '収入', data: chartMonths.map((m) => incMap.get(m) ?? 0), backgroundColor: '#4ade80' },
                    { type: 'bar' as const, label: '支出', data: chartMonths.map((m) => -total(m)), backgroundColor: '#f87171' },
                    {
                      type: 'line' as const,
                      label: '収支',
                      data: chartMonths.map((m) => (incMap.get(m) ?? 0) - total(m)),
                      borderColor: '#38bdf8',
                      tension: 0.3,
                    },
                  ],
                }}
                options={{
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  scales: { y: { ticks: { callback: (v) => yenShort(Number(v)) } } },
                }}
              />
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              ※収入は入力した月のみ表示されます（未入力の月は0）
            </p>
          </div>

          <div className="card">
            <h2>変動費カテゴリ別の推移</h2>
            <div className="chart-box">
              <Line
                data={{
                  labels: chartMonths.map((m) => m.slice(2)),
                  datasets: [...catTrend.entries()].map(([cat, map], i) => ({
                    label: cat,
                    data: chartMonths.map((m) => map.get(m) ?? null),
                    borderColor: PALETTE[i % PALETTE.length],
                    tension: 0.3,
                  })),
                }}
                options={{
                  maintainAspectRatio: false,
                  spanGaps: true,
                  interaction: { mode: 'index', intersect: false },
                  scales: { y: { ticks: { callback: (v) => yenShort(Number(v)) } } },
                }}
              />
            </div>
          </div>

          {(data?.zaim_net.length ?? 0) >= 2 && (
            <div className="card">
              <h2>実収支（Zaim転記・投資除く）</h2>
              <div className="chart-box small">
                <Bar
                  data={{
                    labels: data!.zaim_net.map((z) => z.month.slice(2)),
                    datasets: [{
                      label: '実収支',
                      data: data!.zaim_net.map((z) => z.amount),
                      backgroundColor: data!.zaim_net.map((z) => (z.amount >= 0 ? '#4ade80' : '#f87171')),
                    }],
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
      )}
    </>
  )
}
