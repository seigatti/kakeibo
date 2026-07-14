import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { APPLICATION_METHODS, APPLICATION_STATUSES, type FurusatoItem, type FurusatoPerson } from '../types'
import { furusatoLimit, yen } from '../utils'

const EMPTY_ITEM = {
  id: '',
  year: String(new Date().getFullYear()),
  name: '',
  price: '',
  municipality: '',
  url: '',
  application_status: '未購入',
  application_method: '',
  receipt_status: '未',
  memo: '',
}

export default function Furusato({ prefill }: { prefill: URLSearchParams }) {
  const { data, mutate, saving } = useStore()
  const [person, setPerson] = useState<FurusatoPerson>(
    (localStorage.getItem('kakeibo.furusatoPerson') as FurusatoPerson) || 'せ',
  )
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [form, setForm] = useState(EMPTY_ITEM)
  const [editing, setEditing] = useState(false)
  const [yearForm, setYearForm] = useState({ income: '', social_insurance: '', medical_deduction: '', limit_manual: '' })
  const [msg, setMsg] = useState('')
  const appliedPrefill = useRef<string | null>(null)

  const items = useMemo(() => (data?.furusato_items ?? []).filter((i) => i.person === person), [data, person])
  const years = useMemo(() => data?.furusato_years ?? [], [data])
  const yearInfo = years.find((y) => y.person === person && Number(y.year) === year)

  const selectPerson = (p: FurusatoPerson) => {
    setPerson(p)
    localStorage.setItem('kakeibo.furusatoPerson', p)
  }

  // 年・人の切替で上限フォームへ既存値を反映
  useEffect(() => {
    setYearForm({
      income: yearInfo?.income?.toString() ?? '',
      social_insurance: yearInfo?.social_insurance?.toString() ?? '',
      medical_deduction: yearInfo?.medical_deduction?.toString() ?? '',
      limit_manual: yearInfo?.limit_manual?.toString() ?? '',
    })
  }, [yearInfo])

  // 楽天ブックマークレットからのプリフィル（#furusato?name=…&price=…&url=…&municipality=…）
  useEffect(() => {
    const key = prefill.toString()
    if (!key || appliedPrefill.current === key) return
    if (!prefill.get('name') && !prefill.get('url')) return
    appliedPrefill.current = key
    setForm({
      ...EMPTY_ITEM,
      year: String(year),
      name: prefill.get('name') ?? '',
      price: prefill.get('price') ?? '',
      municipality: prefill.get('municipality') ?? '',
      url: prefill.get('url') ?? '',
      application_status: '購入済み、書類未',
    })
    setEditing(false)
    setMsg('楽天ページから読み取りました。内容を確認して保存してください')
    history.replaceState(null, '', '#furusato')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[,，]/g, '')))

  const limitAuto = furusatoLimit(num(yearForm.income), num(yearForm.social_insurance), num(yearForm.medical_deduction))
  const limitAdopted = num(yearForm.limit_manual) ?? limitAuto
  const purchased = items.filter((i) => Number(i.year) === year && i.application_status !== '未購入' && i.price)
  const purchasedTotal = purchased.reduce((s, i) => s + (i.price ?? 0), 0)
  const remaining = limitAdopted !== null ? limitAdopted - purchasedTotal : null

  const yearItems = items.filter((i) => Number(i.year) === year && i.application_status !== '未購入')
  const candidates = items.filter((i) => !i.year || i.application_status === '未購入')
  const allYears = [...new Set([thisYear, thisYear - 1, thisYear + 1, ...years.filter((y) => y.person === person).map((y) => Number(y.year)), ...items.map((i) => Number(i.year)).filter((y) => y > 2000)])].sort((a, b) => b - a)

  const saveYear = async () => {
    setMsg('')
    await mutate('setFurusatoYear', {
      row: {
        person,
        year,
        income: num(yearForm.income),
        social_insurance: num(yearForm.social_insurance),
        medical_deduction: num(yearForm.medical_deduction),
        limit_manual: num(yearForm.limit_manual),
        memo: yearInfo?.memo ?? null,
      },
    })
    setMsg(`${year}年の上限情報を保存しました ✓`)
  }

  const saveItem = async () => {
    if (!form.name.trim()) return
    setMsg('')
    await mutate('saveFurusatoItem', {
      row: {
        id: form.id || undefined,
        person,
        year: form.year.trim() === '' ? null : Number(form.year),
        name: form.name.trim(),
        price: num(form.price),
        municipality: form.municipality.trim() || null,
        url: form.url.trim() || null,
        application_status: form.application_status,
        application_method: form.application_method.trim() || null,
        receipt_status: form.receipt_status,
        memo: form.memo.trim() || null,
      },
    })
    setForm({ ...EMPTY_ITEM, year: String(year) })
    setEditing(false)
    setMsg(editing ? '更新しました ✓' : '追加しました ✓')
  }

  const editItem = (it: FurusatoItem) => {
    setForm({
      id: it.id,
      year: it.year ? String(it.year) : '',
      name: it.name,
      price: it.price?.toString() ?? '',
      municipality: it.municipality ?? '',
      url: it.url ?? '',
      application_status: it.application_status ?? '未購入',
      application_method: it.application_method ?? '',
      receipt_status: it.receipt_status ?? '未',
      memo: it.memo ?? '',
    })
    setEditing(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const removeItem = async (it: FurusatoItem) => {
    if (!window.confirm(`「${it.name.slice(0, 30)}…」を削除しますか？`)) return
    await mutate('deleteFurusatoItem', { id: it.id })
  }

  const ItemList = ({ list }: { list: FurusatoItem[] }) => (
    <ul className="list">
      {list.map((it) => (
        <li key={it.id} style={{ flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 100%', fontSize: 13 }}>
            {it.url ? (
              <a href={it.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{it.name.slice(0, 45)}{it.name.length > 45 ? '…' : ''}</a>
            ) : (
              <>{it.name.slice(0, 45)}</>
            )}
          </span>
          <span className="muted" style={{ fontSize: 12, flex: 1 }}>
            {it.municipality ?? ''} {it.price ? yen(it.price) : ''}
            {' ・ '}
            <span style={{ color: it.application_status === '完了' ? 'var(--green)' : it.application_status === '未購入' ? 'var(--muted)' : 'var(--amber)' }}>
              {it.application_status}
            </span>
            {it.receipt_status === '済' ? ' ・ 受取済' : ''}
          </span>
          <button className="btn small secondary" onClick={() => editItem(it)}>編集</button>
          <button className="btn danger small" onClick={() => void removeItem(it)}>削除</button>
        </li>
      ))}
      {list.length === 0 && <li className="muted">なし</li>}
    </ul>
  )

  return (
    <>
      <div className="seg">
        {(['せ', 'あ'] as FurusatoPerson[]).map((p) => (
          <button key={p} className={person === p ? 'on' : ''} onClick={() => selectPerson(p)}>{p}</button>
        ))}
        <select style={{ flex: 1, marginTop: 0, width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {allYears.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
      </div>

      <div className="card">
        <h2>{year}年の上限額（{person}）</h2>
        <div className="kv"><span className="muted">採用上限</span><span className="big" style={{ fontSize: 20 }}>{limitAdopted !== null ? yen(limitAdopted) : '未設定'}</span></div>
        <div className="kv"><span className="muted">購入済み合計（{purchased.length}件）</span><span>{yen(purchasedTotal)}</span></div>
        <div className="kv" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <span>追加可能額</span>
          <span className={remaining !== null && remaining < 0 ? 'neg' : 'pos'}>{remaining !== null ? yen(remaining) : '−'}</span>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary className="muted" style={{ fontSize: 13, cursor: 'pointer' }}>上限の計算・入力（年収・社会保険料など）</summary>
          <div className="row2" style={{ marginTop: 8 }}>
            <label className="field">年収（税込・想定可）
              <input type="text" inputMode="numeric" value={yearForm.income} onChange={(e) => setYearForm({ ...yearForm, income: e.target.value })} /></label>
            <label className="field">社会保険料（年額）
              <input type="text" inputMode="numeric" value={yearForm.social_insurance} onChange={(e) => setYearForm({ ...yearForm, social_insurance: e.target.value })} /></label>
          </div>
          <div className="row2">
            <label className="field">医療費控除など
              <input type="text" inputMode="numeric" value={yearForm.medical_deduction} onChange={(e) => setYearForm({ ...yearForm, medical_deduction: e.target.value })} /></label>
            <label className="field">上限の手動指定（優先）
              <input type="text" inputMode="numeric" placeholder={limitAuto ? `計算値: ${limitAuto.toLocaleString()}` : ''} value={yearForm.limit_manual} onChange={(e) => setYearForm({ ...yearForm, limit_manual: e.target.value })} /></label>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            計算上限（目安）: <b>{limitAuto !== null ? yen(limitAuto) : '年収を入力してください'}</b><br />
            ※給与収入のみ・配偶者控除なしの簡易計算です。住宅ローン控除等がある場合はズレます。
            税額通知書などで正確な値が分かったら「手動指定」に入れてください。
          </p>
          <button className="btn" onClick={() => void saveYear()} disabled={saving}>{saving ? '保存中…' : '上限情報を保存'}</button>
        </details>
      </div>

      <div className="card">
        <h2>{editing ? '寄付を編集' : '寄付・候補を追加'}</h2>
        <div className="row2">
          <label className="field">対象年（空欄=候補）
            <input type="text" inputMode="numeric" placeholder="例: 2026" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></label>
          <label className="field">寄付金額
            <input type="text" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
        </div>
        <label className="field">商品名
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <div className="row2">
          <label className="field">自治体
            <input type="text" placeholder="例: 熊本県高森町" value={form.municipality} onChange={(e) => setForm({ ...form, municipality: e.target.value })} /></label>
          <label className="field">URL
            <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
        </div>
        <div className="row2">
          <label className="field">申請状況
            <select value={form.application_status} onChange={(e) => setForm({ ...form, application_status: e.target.value })}>
              {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
          <label className="field">申請方法
            <input type="text" list="furusato-methods" value={form.application_method} onChange={(e) => setForm({ ...form, application_method: e.target.value })} />
            <datalist id="furusato-methods">
              {APPLICATION_METHODS.map((m) => <option key={m} value={m} />)}
            </datalist></label>
        </div>
        <div className="row2">
          <label className="field">商品受取
            <select value={form.receipt_status} onChange={(e) => setForm({ ...form, receipt_status: e.target.value })}>
              <option value="未">未</option>
              <option value="済">済</option>
            </select></label>
          <label className="field">メモ
            <input type="text" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></label>
        </div>
        <button className="btn" onClick={() => void saveItem()} disabled={saving || !form.name.trim()}>{saving ? '保存中…' : editing ? '更新' : '追加'}</button>
        {editing && <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => { setForm({ ...EMPTY_ITEM, year: String(year) }); setEditing(false) }}>キャンセル</button>}
        {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
      </div>

      <div className="card">
        <h2>{year}年の寄付（{yearItems.length}件）</h2>
        <ItemList list={yearItems} />
      </div>

      <div className="card">
        <h2>候補・未購入（{candidates.length}件）</h2>
        <ItemList list={candidates} />
      </div>
    </>
  )
}
