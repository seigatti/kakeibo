import { useState } from 'react'
import { useStore } from '../store'
import type { FixedCostRow, Frequency } from '../types'
import { fixedMonthlyTotal, monthlyShare, thisMonth, yen } from '../utils'

const EMPTY = { id: '', name: '', amount: '', frequency: '月' as Frequency, start_month: '', end_month: '', memo: '' }

export default function FixedCosts() {
  const { data, mutate, saving } = useStore()
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(false)

  if (!data) return null
  const costs = data.fixed_costs
  const month = thisMonth()

  const edit = (fc: FixedCostRow) => {
    setForm({
      id: fc.id,
      name: fc.name,
      amount: String(fc.amount),
      frequency: fc.frequency,
      start_month: fc.start_month ?? '',
      end_month: fc.end_month ?? '',
      memo: fc.memo ?? '',
    })
    setEditing(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    if (!form.name.trim() || !form.amount.trim()) return
    await mutate('saveFixedCost', {
      row: {
        id: form.id || undefined,
        name: form.name.trim(),
        amount: Number(form.amount.replace(/[,，]/g, '')),
        frequency: form.frequency,
        start_month: form.start_month || null,
        end_month: form.end_month || null,
        memo: form.memo || null,
      },
    })
    setForm(EMPTY)
    setEditing(false)
  }

  const remove = async (fc: FixedCostRow) => {
    if (!window.confirm(`「${fc.name}」を削除しますか？\n（過去に遡って月割りから消えます。やめた月が決まっている場合は「終了月」の設定がおすすめ）`)) return
    await mutate('deleteFixedCost', { id: fc.id })
  }

  return (
    <>
      <div className="card">
        <h2>{editing ? '固定費を編集' : '固定費を追加'}</h2>
        <div className="row2">
          <label className="field">名前
            <input type="text" placeholder="例: 火災保険" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field">金額（1回あたり）
            <input type="text" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
        </div>
        <div className="row2">
          <label className="field">支払い頻度
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}>
              <option value="月">毎月</option>
              <option value="年">毎年</option>
              <option value="2年">2年ごと（車検など）</option>
            </select></label>
          <label className="field">メモ
            <input type="text" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></label>
        </div>
        <div className="row2">
          <label className="field">開始月（任意）
            <input type="month" value={form.start_month} onChange={(e) => setForm({ ...form, start_month: e.target.value })} /></label>
          <label className="field">終了月（任意・解約時）
            <input type="month" value={form.end_month} onChange={(e) => setForm({ ...form, end_month: e.target.value })} /></label>
        </div>
        <button className="btn" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : editing ? '更新' : '追加'}</button>
        {editing && (
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => { setForm(EMPTY); setEditing(false) }}>キャンセル</button>
        )}
      </div>

      <div className="card">
        <h2>現在の月割り合計: {yen(fixedMonthlyTotal(costs, month))} / 月</h2>
        <ul className="list">
          {costs.map((fc) => {
            const active = monthlyShare(fc, month) > 0
            return (
              <li key={fc.id} style={active ? undefined : { opacity: 0.45 }}>
                <span style={{ flex: 1 }}>
                  {fc.name}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {' '}
                    {yen(fc.amount)}/{fc.frequency}
                    {fc.end_month ? `（〜${fc.end_month}）` : ''}
                  </span>
                </span>
                <span>{yen(monthlyShare(fc))}/月</span>
                <button className="btn small secondary" onClick={() => edit(fc)}>編集</button>
                <button className="btn danger small" onClick={() => void remove(fc)}>削除</button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
