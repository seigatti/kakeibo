import { useState } from 'react'
import HelpTip from '../components/HelpTip'
import { useStore } from '../store'
import { LIABILITY_KINDS, type LiabilityKind, type LiabilityRow } from '../types'
import { annualLoanPayment, liabilityBalanceAt, thisMonth, yen } from '../utils'

const EMPTY = {
  id: '',
  name: '',
  kind: 'ローン' as LiabilityKind,
  principal: '',
  start_month: '',
  rate: '',
  years: '',
  balance_manual: '',
  memo: '',
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[,，]/g, '')))

/** 負債（住宅ローン・奨学金・車ローン等）の管理。資産タブに配置し、純資産の計算に使う */
export default function LiabilityCard() {
  const { data, mutate, saving } = useStore()
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState('')

  const liabilities = data?.liabilities ?? []
  const month = thisMonth()
  const total = liabilities.reduce((s, l) => s + liabilityBalanceAt(l, month), 0)

  const save = async () => {
    if (!form.name.trim()) return
    setMsg('')
    await mutate('saveLiability', {
      row: {
        id: form.id || undefined,
        name: form.name.trim(),
        kind: form.kind,
        principal: num(form.principal),
        start_month: form.start_month || null,
        rate: num(form.rate),
        years: num(form.years),
        balance_manual: num(form.balance_manual),
        memo: form.memo.trim() || null,
      },
    })
    setForm(EMPTY)
    setEditing(false)
    setMsg(editing ? '更新しました ✓' : '追加しました ✓')
  }

  const edit = (l: LiabilityRow) => {
    setForm({
      id: l.id,
      name: l.name,
      kind: (l.kind as LiabilityKind) ?? 'ローン',
      principal: l.principal?.toString() ?? '',
      start_month: l.start_month ?? '',
      rate: l.rate?.toString() ?? '',
      years: l.years?.toString() ?? '',
      balance_manual: l.balance_manual?.toString() ?? '',
      memo: l.memo ?? '',
    })
    setEditing(true)
  }

  const remove = async (l: LiabilityRow) => {
    if (!window.confirm(`「${l.name}」を削除しますか？`)) return
    await mutate('deleteLiability', { id: l.id })
  }

  return (
    <div className="card">
      <h2>
        負債（現在残高 合計: {yen(total)}）
        <HelpTip title="負債残高の計算">
          「ローン」は当初借入額・開始月・金利・返済年数から元利均等返済の残高を自動計算します（過去も将来も推定できるので純資産の推移が描けます）。
          {'\n'}「現在残高（実測）」を入れると、その値を優先し、繰上返済などのズレを将来にも反映します。
          {'\n'}「その他」は残高固定（返済スケジュールなし）として扱います。
        </HelpTip>
      </h2>

      <ul className="list">
        {liabilities.map((l) => (
          <li key={l.id} style={{ flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 100%', fontSize: 13 }}>
              {l.name}
              <span className="muted" style={{ fontSize: 11 }}>
                {' '}{l.kind}
                {l.kind === 'ローン' && l.principal ? ` ・当初${yen(l.principal)}・${l.rate ?? 0}%・${l.years ?? 0}年` : ''}
              </span>
            </span>
            <span style={{ flex: 1 }}>{yen(liabilityBalanceAt(l, month))}</span>
            {l.kind === 'ローン' && l.principal && l.years ? (
              <span className="muted" style={{ fontSize: 11 }}>
                返済 {yen(annualLoanPayment(l.principal, l.rate ?? 0, l.years) / 12)}/月
              </span>
            ) : null}
            <button className="btn small secondary" onClick={() => edit(l)}>編集</button>
            <button className="btn danger small" onClick={() => void remove(l)}>削除</button>
          </li>
        ))}
        {liabilities.length === 0 && <li className="muted">負債の登録はありません</li>}
      </ul>

      <h2 style={{ marginTop: 12 }}>{editing ? '負債を編集' : '負債を追加'}</h2>
      <div className="row2">
        <label className="field">名前
          <input type="text" placeholder="例: 住宅ローン / 奨学金" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field">種類
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as LiabilityKind })}>
            {LIABILITY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select></label>
      </div>
      {form.kind === 'ローン' ? (
        <>
          <div className="row2">
            <label className="field">当初借入額
              <input type="text" inputMode="numeric" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></label>
            <label className="field">返済開始月
              <input type="month" value={form.start_month} onChange={(e) => setForm({ ...form, start_month: e.target.value })} /></label>
          </div>
          <div className="row2">
            <label className="field">金利（%/年）
              <input type="text" inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></label>
            <label className="field">返済年数
              <input type="text" inputMode="numeric" value={form.years} onChange={(e) => setForm({ ...form, years: e.target.value })} /></label>
          </div>
          <label className="field">現在残高（実測・任意）
            <input type="text" inputMode="numeric" placeholder="入れると計算値より優先" value={form.balance_manual} onChange={(e) => setForm({ ...form, balance_manual: e.target.value })} /></label>
        </>
      ) : (
        <label className="field">現在残高
          <input type="text" inputMode="numeric" value={form.balance_manual} onChange={(e) => setForm({ ...form, balance_manual: e.target.value })} /></label>
      )}
      <label className="field">メモ
        <input type="text" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></label>
      <button className="btn" onClick={() => void save()} disabled={saving || !form.name.trim()}>
        {saving ? '保存中…' : editing ? '更新' : '追加'}
      </button>
      {editing && (
        <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => { setForm(EMPTY); setEditing(false) }}>キャンセル</button>
      )}
      {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}
