import { useMemo, useRef, useState } from 'react'
import {
  aggregate,
  defaultMapping,
  parseZaimCsv,
  TARGET_IGNORE,
  TARGET_OTHER_INCOME,
  TARGET_SALARY,
  type ZaimParsed,
} from '../csvImport'
import { useStore } from '../store'
import { yen } from '../utils'

export default function CsvImportCard({ categories }: { categories: string[] }) {
  const { data, mutate, saving } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ZaimParsed | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const savedMapping = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'csv_category_map')?.value
    try {
      return raw ? (JSON.parse(raw) as Record<string, string>) : {}
    } catch {
      return {}
    }
  }, [data])

  const targets = [...categories, TARGET_SALARY, TARGET_OTHER_INCOME, TARGET_IGNORE]

  const onFile = async (file: File) => {
    setMsg('')
    setErr('')
    try {
      const p = parseZaimCsv(await file.arrayBuffer())
      setParsed(p)
      setMapping(defaultMapping(p, categories, savedMapping))
    } catch (e) {
      setParsed(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const aggs = useMemo(() => (parsed ? aggregate(parsed.txns, mapping) : []), [parsed, mapping])

  const register = async () => {
    setMsg('')
    setErr('')
    const months = aggs.map((a) => ({
      income:
        a.salary !== null || a.other !== null
          ? { month: a.month, salary: a.salary, other: a.other, memo: 'CSV取込' }
          : null,
      expenses: Object.entries(a.expenses).map(([category, amount]) => ({
        month: a.month,
        category,
        amount: Math.round(amount),
      })),
    }))
    try {
      await mutate('setMonthsData', { months })
      await mutate('setSetting', { row: { key: 'csv_category_map', value: JSON.stringify(mapping) } })
      setMsg(`${aggs.length}ヶ月分を登録しました ✓（対応付けも保存済み）`)
      setParsed(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="card">
      <h2>Zaim CSVインポート（収支の一括登録）</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Zaim Web版の「記録の出力（CSV）」でダウンロードしたファイルを選ぶと、
        月ごとの給料・変動費を自動集計して登録します。同じ月・同じカテゴリは上書きされます。
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
      />
      {err && <p className="neg" style={{ fontSize: 13 }}>⚠ {err}</p>}

      {parsed && (
        <>
          <h2 style={{ marginTop: 14 }}>1. カテゴリの対応付け（{parsed.months[0]} 〜 {parsed.months[parsed.months.length - 1]}）</h2>
          <ul className="list">
            {parsed.keys.map((key) => (
              <li key={key}>
                <span style={{ flex: 1, fontSize: 13 }}>{key}</span>
                <select
                  style={{ width: 'auto', marginTop: 0 }}
                  value={mapping[key] ?? TARGET_IGNORE}
                  onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                >
                  {targets.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          <h2 style={{ marginTop: 14 }}>2. 集計プレビュー</h2>
          {aggs.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>対応付けの結果、登録対象がありません（すべて「無視」）</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: 12, borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 4 }}>月</th>
                    <th style={{ textAlign: 'right', padding: 4 }}>給料</th>
                    <th style={{ textAlign: 'right', padding: 4 }}>その他収入</th>
                    {categories.filter((c) => aggs.some((a) => a.expenses[c] !== undefined)).map((c) => (
                      <th key={c} style={{ textAlign: 'right', padding: 4 }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aggs.map((a) => (
                    <tr key={a.month} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 4 }}>{a.month}</td>
                      <td style={{ textAlign: 'right', padding: 4 }}>{a.salary !== null ? yen(a.salary) : '−'}</td>
                      <td style={{ textAlign: 'right', padding: 4 }}>{a.other !== null ? yen(a.other) : '−'}</td>
                      {categories.filter((c) => aggs.some((x) => x.expenses[c] !== undefined)).map((c) => (
                        <td key={c} style={{ textAlign: 'right', padding: 4 }}>
                          {a.expenses[c] !== undefined ? yen(a.expenses[c]) : '−'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="btn" style={{ marginTop: 10 }} onClick={() => void register()} disabled={saving || aggs.length === 0}>
            {saving ? '登録中…' : `この内容で登録（${aggs.length}ヶ月分）`}
          </button>
        </>
      )}
      {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}
