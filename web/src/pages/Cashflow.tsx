import { useEffect, useMemo, useState } from 'react'
import { Chart, Line } from 'react-chartjs-2'
import { useStore } from '../store'
import { DEFAULT_CATEGORIES } from '../types'
import HelpTip from '../components/HelpTip'
import { DEFAULT_PERSONS } from '../types'
import { addMonths, amt, dataMonthRange, DEFAULT_PRINCIPAL_CAP, effectiveIncomeByMonth, estimateOtherExpense, expenseByMonth, fixedMonthlyTotal, netSalaryByMonth, nonInvestBreakdownByMonth, thisMonth, yen, yenShort } from '../utils'
import CsvImportCard from './CsvImportCard'
import SalaryCard from './SalaryCard'

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

  const persons = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'furusato_persons')?.value
    const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_PERSONS
    return list.length ? list : DEFAULT_PERSONS
  }, [data])

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
  // 給料が未入力の月は、ふるさとの給与データの手取り（総支給−控除合計）を収入として扱う
  const netByMonth = useMemo(() => netSalaryByMonth(data?.furusato_salaries ?? []), [data])
  const months = useMemo(
    () => (data ? dataMonthRange(data.expenses, data.income, [...netByMonth.keys()]) : []),
    [data, netByMonth],
  )
  const chartMonths = months.slice(-24)
  const expMap = useMemo(() => expenseByMonth(data?.expenses ?? []), [data])
  const incMap = useMemo(() => effectiveIncomeByMonth(data?.income ?? [], data?.furusato_salaries ?? []), [data])
  const fixedOf = (m: string) => fixedMonthlyTotal(data?.fixed_costs ?? [], m)

  const catTrend = useMemo(() => {
    const byCat = new Map<string, Map<string, number>>()
    for (const e of data?.expenses ?? []) {
      if (!byCat.has(e.category)) byCat.set(e.category, new Map())
      byCat.get(e.category)!.set(e.month, e.amount)
    }
    return byCat
  }, [data])

  // その他支出の推計: 収入 − 固定費 − 変動費 − 非投資の資産増減（Δ現金＋Δ投資元本。年金は除外）
  // |Δ投資元本| がしきい値を超える月は売買とみなし Δ元本を除外（設定 principal_cap で変更可）
  const principalCap = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'principal_cap')?.value
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PRINCIPAL_CAP
  }, [data])
  const [capInput, setCapInput] = useState<string | null>(null)
  const breakdown = useMemo(() => nonInvestBreakdownByMonth(data?.assets ?? [], principalCap), [data, principalCap])
  const otherOf = (m: string) =>
    estimateOtherExpense(incMap.get(m) ?? 0, fixedOf(m), expMap.get(m) ?? 0, breakdown.get(m)?.delta)

  const total = (m: string) => (expMap.get(m) ?? 0) + fixedOf(m) + (otherOf(m) ?? 0)

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
          <label className="field">
            給料（空欄=給与データの手取り）
            <HelpTip title="給料の自動採用">
              給料が未入力の月は、下の「月次給与」カードで入力した給与の手取り（総支給−控除合計）を全員分合算して収入として使います。手入力があればそちらが優先されます。控除が未入力の月は総支給がそのまま使われます。
            </HelpTip>
            <input type="text" inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)}
              placeholder={
                netByMonth.get(month) !== undefined
                  ? `手取り: ${amt(netByMonth.get(month)!)}`
                  : prevIncome?.salary
                    ? `前月: ${amt(prevIncome.salary)}`
                    : undefined
              } /></label>
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

      <SalaryCard persons={persons} />

      {chartMonths.length >= 2 && (
        <>
          <div className="card">
            <h2>
              収入 vs 全支出（投資除く）
              <HelpTip title="全支出の内訳と算出式">
                支出は3つに分けて積み上げ表示します。
                {'\n'}・固定費: 固定費タブの月割り額
                {'\n'}・変動費: 収支入力（CSVインポート含む）の合計
                {'\n'}・その他支出（推計）= 収入 − 固定費 − 変動費 − 非投資の資産増減
                {'\n'}　非投資の資産増減 = Δ現金 + Δ投資元本（投資元本 = 投資評価額 − 評価損益。投資の値動きを排除し、積立などの資産間移動は支出になりません）
                {'\n'}・年金は値動きが評価損益に含まれず、拠出も給与天引き（手取り外）のため計算から除外しています
                {'\n'}・Δ投資元本が売買判定しきい値（既定20万円・内訳表の下で変更可）を超えて<b>マイナス（売却方向）</b>の月は売買（や損益リセット・記録ずれ）とみなし、Δ元本を除外してΔ現金のみで算出します。プラス方向（積立・買付）は現金と相殺されるため除外しません
                {'\n'}・売買月に通常の積立も同時にあった場合、その積立分は近似としてその他支出に混ざります
                {'\n'}・その他支出が負になる月（未把握の収入や記録誤差）は0として表示、算出できない月はバー自体を表示しません
                {'\n'}・「月末の資産」は記録から自動判定します: 日付が5日以内の記録は前月末の値とみなします（例: 7/1の記録=6月末）。投資（マネフォ）と現金（Zaim）の記録日が別でも、項目ごとに最後の値で合成するので大丈夫です
                {'\n'}・当月末と前月末の両方に資産記録があり、評価損益（MFブックマークレットで自動記録）が両方の月にあることが算出の条件です
              </HelpTip>
            </h2>
            <div className="chart-box">
              <Chart
                type="bar"
                data={{
                  labels: chartMonths.map((m) => m.slice(2)),
                  datasets: [
                    { type: 'bar' as const, label: '収入', data: chartMonths.map((m) => incMap.get(m) ?? 0), backgroundColor: '#4ade80', stack: 'in' },
                    { type: 'bar' as const, label: '固定費', data: chartMonths.map((m) => -fixedOf(m)), backgroundColor: '#fb923c', stack: 'out' },
                    { type: 'bar' as const, label: '変動費', data: chartMonths.map((m) => -(expMap.get(m) ?? 0)), backgroundColor: '#f87171', stack: 'out' },
                    {
                      type: 'bar' as const,
                      label: 'その他支出(推計)',
                      data: chartMonths.map((m) => {
                        const o = otherOf(m)
                        return o === null ? null : -o // 算出不能月は0ではなく非表示
                      }),
                      backgroundColor: '#c084fc',
                      stack: 'out',
                    },
                    {
                      type: 'line' as const,
                      label: '収支',
                      data: chartMonths.map((m) => (incMap.get(m) ?? 0) - total(m)),
                      borderColor: '#38bdf8',
                      tension: 0.3,
                      stack: 'balance',
                    },
                  ],
                }}
                options={{
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => yenShort(Number(v)) } } },
                }}
              />
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              ※その他支出を算出できた月: {chartMonths.filter((m) => otherOf(m) !== null).length}/{chartMonths.length}。
              算出には前月末と当月末の資産記録（投資・現金）と評価損益が必要です。
              給料が未入力の月は給与データの手取りを収入として表示します（手入力が優先）
            </p>
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ fontSize: 13, cursor: 'pointer' }}>その他支出の内訳（診断用）</summary>
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table style={{ fontSize: 11, borderCollapse: 'collapse', whiteSpace: 'nowrap', width: '100%' }}>
                  <thead>
                    <tr className="muted">
                      <th style={{ padding: 3, textAlign: 'left' }}>月</th>
                      <th style={{ padding: 3, textAlign: 'right' }}>Δ現金</th>
                      <th style={{ padding: 3, textAlign: 'right' }}>Δ投資</th>
                      <th style={{ padding: 3, textAlign: 'right' }}>Δ評価損益</th>
                      <th style={{ padding: 3, textAlign: 'right' }}>Δ投資元本</th>
                      <th style={{ padding: 3, textAlign: 'right' }}>収入</th>
                      <th style={{ padding: 3, textAlign: 'right' }}>固定+変動</th>
                      <th style={{ padding: 3, textAlign: 'right' }}>その他支出</th>
                      <th style={{ padding: 3 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartMonths.filter((m) => breakdown.has(m)).map((m) => {
                      const b = breakdown.get(m)!
                      const income = incMap.get(m) ?? 0
                      const suspicious = !b.tradeExcluded && income > 0 && Math.abs(b.dPrincipal) > income * 1.5
                      return (
                        <tr key={m} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 3 }}>{m.slice(2)}</td>
                          <td style={{ padding: 3, textAlign: 'right' }}>{yenShort(b.dCash)}</td>
                          <td style={{ padding: 3, textAlign: 'right' }}>{yenShort(b.dInvest)}</td>
                          <td style={{ padding: 3, textAlign: 'right' }}>{yenShort(b.dProfit)}</td>
                          <td style={{ padding: 3, textAlign: 'right', textDecoration: b.tradeExcluded ? 'line-through' : undefined }}
                            className={suspicious ? 'neg' : b.tradeExcluded ? 'muted' : ''}>{yenShort(b.dPrincipal)}</td>
                          <td style={{ padding: 3, textAlign: 'right' }}>{yenShort(income)}</td>
                          <td style={{ padding: 3, textAlign: 'right' }}>{yenShort(fixedOf(m) + (expMap.get(m) ?? 0))}</td>
                          <td style={{ padding: 3, textAlign: 'right' }}>{otherOf(m) !== null ? yenShort(otherOf(m)!) : '−'}</td>
                          <td style={{ padding: 3 }} title={b.tradeExcluded ? '売買とみなしΔ元本を除外済み' : undefined}>
                            {b.tradeExcluded ? '売買' : suspicious ? '⚠' : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                Δ投資元本 = Δ投資 − Δ評価損益（その月の積立・売却の純額に相当）。
                「売買」= Δ投資元本がしきい値を超えてマイナス（売却方向）のため、売買（や損益リセット・記録ずれ）とみなして<b>Δ元本を除外し Δ現金のみで算出</b>した月（取り消し線）。
                記録の誤りが原因の場合は、資産タブで該当日付の評価損益を修正すればより正確になります。
              </p>
              <div style={{ display: 'flex', gap: 6, alignItems: 'end', marginTop: 8 }}>
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>売買判定しきい値（Δ元本がこれ超のマイナスで除外）
                  <input type="text" inputMode="numeric" value={capInput ?? String(principalCap)}
                    onChange={(e) => setCapInput(e.target.value)} /></label>
                <button className="btn secondary small" style={{ marginBottom: 2 }} disabled={saving || capInput === null}
                  onClick={() => {
                    const n = Number((capInput ?? '').replace(/[,，]/g, ''))
                    if (Number.isFinite(n) && n > 0) {
                      void mutate('setSetting', { row: { key: 'principal_cap', value: String(n) } }).then(() => setCapInput(null))
                    }
                  }}>保存</button>
              </div>
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
                売却方向（マイナス）だけを判定するので、積立額の大小には影響されません。頻繁に売却する運用なら小さめに、しない運用なら大きめでOKです
              </p>
            </details>
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
              <h2>
                現金収支の推移（Zaim転記・過去データ）
                <HelpTip title="このグラフについて">
                  Excel時代にZaimの「分析＞月ごと」から転記していた現金ベースの月次収支（投資除く）の記録です。
                  移行した過去データ（2023-09〜2024-08）のみで、現在は更新されません。
                  現在の全体像は上の「収入 vs 全支出（投資除く）」で確認できます。
                </HelpTip>
              </h2>
              <div className="chart-box small">
                <Line
                  data={{
                    labels: data!.zaim_net.map((z) => z.month.slice(2)),
                    datasets: [{
                      label: '現金収支',
                      data: data!.zaim_net.map((z) => z.amount),
                      borderColor: '#38bdf8',
                      backgroundColor: 'rgba(56, 189, 248, 0.15)',
                      fill: true,
                      tension: 0.3,
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
