import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import type { BonusConfig, FurusatoPerson, FurusatoYear } from '../types'
import { deductionTotal, estimateSalary, parseBonusConfig, yen } from '../utils'

interface Props {
  person: FurusatoPerson
  year: number
  yearInfo: FurusatoYear | undefined
  onReflect: (income: number, social: number | null) => void
}

const EMPTY_MONTH = { gross: '', health: '', pension_ins: '', employment: '', income_tax: '', resident_tax: '' }
type BonusRow = { month: string; months: string; amount: string }

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[,，]/g, '')))
const cell = { padding: '4px 6px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }

export default function SalaryCard({ person, year, yearInfo, onReflect }: Props) {
  const { data, mutate, saving } = useStore()
  const [month, setMonth] = useState(1)
  const [form, setForm] = useState(EMPTY_MONTH)
  const [bonusBase, setBonusBase] = useState('')
  const [bonusRows, setBonusRows] = useState<BonusRow[]>([])
  const [msg, setMsg] = useState('')

  const salaries = useMemo(
    () => (data?.furusato_salaries ?? []).filter((s) => s.person === person && Number(s.year) === year),
    [data, person, year],
  )

  // 年・人の切替でボーナス設定を読み込み
  useEffect(() => {
    setBonusBase(yearInfo?.bonus_base?.toString() ?? '')
    const cfg = parseBonusConfig(yearInfo?.bonus_config)
    setBonusRows(
      Object.entries(cfg)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([m, c]) => ({ month: m, months: c?.months?.toString() ?? '', amount: c?.amount?.toString() ?? '' })),
    )
    setMsg('')
  }, [yearInfo, person, year])

  // 月切替で既存値をフォームへ
  useEffect(() => {
    const hit = salaries.find((s) => Number(s.month) === month)
    setForm({
      gross: hit?.gross?.toString() ?? '',
      health: hit?.health?.toString() ?? '',
      pension_ins: hit?.pension_ins?.toString() ?? '',
      employment: hit?.employment?.toString() ?? '',
      income_tax: hit?.income_tax?.toString() ?? '',
      resident_tax: hit?.resident_tax?.toString() ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, person, year, data])

  // 編集中のボーナス設定（未保存でも見積もりに反映）
  const liveBonusConfig: BonusConfig = useMemo(() => {
    const cfg: BonusConfig = {}
    for (const r of bonusRows) {
      const m = Number(r.month)
      if (!(m >= 1 && m <= 12)) continue
      cfg[String(m)] = { months: num(r.months), amount: num(r.amount) }
    }
    return cfg
  }, [bonusRows])

  const est = estimateSalary(salaries, num(bonusBase), liveBonusConfig)
  const formDeduction = deductionTotal({
    health: num(form.health),
    pension_ins: num(form.pension_ins),
    employment: num(form.employment),
    income_tax: num(form.income_tax),
    resident_tax: num(form.resident_tax),
  })

  const saveMonth = async () => {
    setMsg('')
    await mutate('setFurusatoSalary', {
      row: {
        person, year, month,
        gross: num(form.gross),
        health: num(form.health),
        pension_ins: num(form.pension_ins),
        employment: num(form.employment),
        income_tax: num(form.income_tax),
        resident_tax: num(form.resident_tax),
      },
    })
    setMsg(`${month}月分を保存しました ✓`)
  }

  const clearMonth = async () => {
    if (!window.confirm(`${month}月分の給与記録を削除しますか？`)) return
    await mutate('deleteFurusatoSalary', { person, year, month })
    setForm(EMPTY_MONTH)
  }

  const saveBonus = async () => {
    setMsg('')
    // 上限系の保存済み値は維持しつつ、ボーナス列だけ更新
    await mutate('setFurusatoYear', {
      row: {
        person, year,
        income: yearInfo?.income ?? null,
        social_insurance: yearInfo?.social_insurance ?? null,
        medical_deduction: yearInfo?.medical_deduction ?? null,
        limit_manual: yearInfo?.limit_manual ?? null,
        memo: yearInfo?.memo ?? null,
        bonus_base: num(bonusBase),
        bonus_config: JSON.stringify(liveBonusConfig),
      },
    })
    setMsg('ボーナス設定を保存しました ✓')
  }

  const bonusOf = (m: number) => est?.monthlyBonus.find((b) => b.month === m)

  return (
    <div className="card">
      <h2>月次給与から年収を想定（{person}・{year}年）</h2>
      {est ? (
        <>
          <div className="kv"><span className="muted">年収想定（給与{est.enteredMonths}ヶ月入力）</span><b>{yen(est.annualIncome)}</b></div>
          <div className="kv"><span className="muted">　うちボーナス</span><span style={{ color: 'var(--amber)' }}>{yen(est.bonusTotal)}</span></div>
          <div className="kv"><span className="muted">社会保険料想定</span><b>{est.annualSocial > 0 ? yen(est.annualSocial) : '社保の入力なし'}</b></div>
          {est.usedAvgAsBonusBase && (
            <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>※ボーナス基準月額が未入力のため平均総支給で代用しています</p>
          )}
          <button className="btn secondary" style={{ margin: '8px 0' }}
            onClick={() => onReflect(est.annualIncome, est.annualSocial > 0 ? est.annualSocial : null)}>
            この想定を上限計算に反映 ↑
          </button>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr className="muted">
                  <th style={cell}>月</th><th style={cell}>総支給</th><th style={cell}>ボーナス</th><th style={cell}>健保</th>
                  <th style={cell}>厚年</th><th style={cell}>雇用</th><th style={cell}>所得税</th><th style={cell}>住民税</th><th style={cell}>控除計</th>
                </tr>
              </thead>
              <tbody>
                {est.monthlyGross.map((g) => {
                  const hit = salaries.find((s) => Number(s.month) === g.month)
                  const bonus = bonusOf(g.month)
                  const ded = hit ? deductionTotal(hit) : null
                  const estStyle = { color: 'var(--muted)', fontStyle: 'italic' as const }
                  return (
                    <tr key={g.month} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer', background: month === g.month ? 'var(--bg3)' : undefined }}
                      onClick={() => setMonth(g.month)}>
                      <td style={cell}>{g.month}月</td>
                      <td style={{ ...cell, ...(g.entered ? {} : estStyle) }}>{yen(g.gross)}{g.entered ? '' : '*'}</td>
                      <td style={{ ...cell, color: 'var(--amber)' }}>
                        {bonus ? <>🎁 +{yen(bonus.amount)}<span className="muted" style={{ fontSize: 10 }}>{bonus.manual ? '(手動)' : `(${bonus.months}ヶ月)`}</span></> : ''}
                      </td>
                      <td style={cell}>{hit?.health != null ? yen(hit.health) : ''}</td>
                      <td style={cell}>{hit?.pension_ins != null ? yen(hit.pension_ins) : ''}</td>
                      <td style={cell}>{hit?.employment != null ? yen(hit.employment) : ''}</td>
                      <td style={cell}>{hit?.income_tax != null ? yen(hit.income_tax) : ''}</td>
                      <td style={cell}>{hit?.resident_tax != null ? yen(hit.resident_tax) : ''}</td>
                      <td style={{ ...cell, color: 'var(--muted)' }}>{ded !== null ? yen(ded) : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            *印は未入力月（入力済み月の平均で想定）。行タップで下のフォームに読み込み。<br />
            社会保険料想定 = 平均月社保×12 + ボーナス合計×社保率（賞与分の概算）
          </p>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>まだ給与の入力がありません。下のフォームから総支給額を入力すると年収を自動で想定します。</p>
      )}

      <h2 style={{ marginTop: 14 }}>{month}月分の入力</h2>
      <div className="seg" style={{ flexWrap: 'wrap' }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <button key={m} className={month === m ? 'on' : ''} style={{ flex: '1 0 14%' }} onClick={() => setMonth(m)}>{m}</button>
        ))}
      </div>
      <div className="row2">
        <label className="field">総支給額
          <input type="text" inputMode="numeric" value={form.gross} onChange={(e) => setForm({ ...form, gross: e.target.value })} /></label>
        <label className="field">健康保険
          <input type="text" inputMode="numeric" value={form.health} onChange={(e) => setForm({ ...form, health: e.target.value })} /></label>
      </div>
      <div className="row2">
        <label className="field">厚生年金保険
          <input type="text" inputMode="numeric" value={form.pension_ins} onChange={(e) => setForm({ ...form, pension_ins: e.target.value })} /></label>
        <label className="field">雇用保険
          <input type="text" inputMode="numeric" value={form.employment} onChange={(e) => setForm({ ...form, employment: e.target.value })} /></label>
      </div>
      <div className="row2">
        <label className="field">所得税
          <input type="text" inputMode="numeric" value={form.income_tax} onChange={(e) => setForm({ ...form, income_tax: e.target.value })} /></label>
        <label className="field">住民税
          <input type="text" inputMode="numeric" value={form.resident_tax} onChange={(e) => setForm({ ...form, resident_tax: e.target.value })} /></label>
      </div>
      <div className="kv"><span className="muted">控除合計（自動計算）</span><b>{formDeduction !== null ? yen(formDeduction) : '−'}</b></div>
      <button className="btn" onClick={() => void saveMonth()} disabled={saving}>{saving ? '保存中…' : `${month}月分を保存`}</button>
      {salaries.some((s) => Number(s.month) === month) && (
        <button className="btn danger" style={{ marginTop: 8 }} onClick={() => void clearMonth()}>この月の記録を削除</button>
      )}

      <h2 style={{ marginTop: 14 }}>ボーナス設定（{year}年）</h2>
      <label className="field">基準月額（例: 基本給。未入力なら平均総支給で代用）
        <input type="text" inputMode="numeric" value={bonusBase} onChange={(e) => setBonusBase(e.target.value)} /></label>
      {bonusRows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'end', marginBottom: 6 }}>
          <label className="field" style={{ marginBottom: 0, flex: 1 }}>月
            <select value={r.month} onChange={(e) => setBonusRows(bonusRows.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))}>
              {Array.from({ length: 12 }, (_, k) => k + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
            </select></label>
          <label className="field" style={{ marginBottom: 0, flex: 1 }}>か月分
            <input type="text" inputMode="decimal" placeholder="例: 2.0" value={r.months}
              onChange={(e) => setBonusRows(bonusRows.map((x, j) => (j === i ? { ...x, months: e.target.value } : x)))} /></label>
          <label className="field" style={{ marginBottom: 0, flex: 1.4 }}>金額（手動・優先）
            <input type="text" inputMode="numeric" placeholder="任意" value={r.amount}
              onChange={(e) => setBonusRows(bonusRows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} /></label>
          <button className="btn danger small" style={{ marginBottom: 2 }} onClick={() => setBonusRows(bonusRows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn secondary" style={{ marginBottom: 8 }}
        onClick={() => setBonusRows([...bonusRows, { month: bonusRows.length ? '12' : '6', months: '', amount: '' }])}>
        ＋ ボーナス月を追加
      </button>
      <button className="btn" onClick={() => void saveBonus()} disabled={saving}>{saving ? '保存中…' : 'ボーナス設定を保存'}</button>
      {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}
