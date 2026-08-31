import HelpTip from '../components/HelpTip'
import Modal from '../components/Modal'
import { APPLICATION_METHODS, APPLICATION_STATUSES } from '../types'

export interface ItemForm {
  id: string
  year: string
  name: string
  price: string
  municipality: string
  url: string
  application_status: string
  application_method: string
  receipt_status: string
  memo: string
  market_price: string
  /** 還元率(%)。市場価格と双方向に連動し、保存されるのは市場価格のみ */
  rate: string
  priority: string
}

export const EMPTY_ITEM: ItemForm = {
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
  market_price: '',
  rate: '',
  priority: '3',
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[,，]/g, '')))

/** 市場価格 → 還元率(%) の表示文字列 */
export function rateTextOf(price: string, market: string): string {
  const p = num(price)
  const m = num(market)
  if (p === null || m === null || p <= 0 || !Number.isFinite(p) || !Number.isFinite(m)) return ''
  return String(Math.round((m / p) * 1000) / 10)
}

interface Props {
  form: ItemForm
  setForm: (f: ItemForm) => void
  editing: boolean
  saving: boolean
  onSave: () => void
  onClose: () => void
  /** 商品名でAmazon/楽天市場の検索を開く（対象idを控えてブックマークレットに備える） */
  onSearchMarket: (site: 'amazon' | 'rakuten') => void
}

/**
 * 寄付・候補の追加／編集モーダル。
 * 一覧の上に重ねて出すので、閉じたときに元のスクロール位置がそのまま残る。
 */
export default function FurusatoItemModal({ form, setForm, editing, saving, onSave, onClose, onSearchMarket }: Props) {
  // 市場価格を入れたら還元率が、還元率を入れたら市場価格が埋まる（保存するのは市場価格だけ）
  const setMarket = (v: string) => setForm({ ...form, market_price: v, rate: rateTextOf(form.price, v) })
  const setRate = (v: string) => {
    const p = num(form.price)
    const r = num(v)
    const market = p !== null && r !== null && p > 0 ? String(Math.round((p * r) / 100)) : form.market_price
    setForm({ ...form, rate: v, market_price: market })
  }
  // 寄付額を変えたら還元率の表示も追従させる
  const setPrice = (v: string) => setForm({ ...form, price: v, rate: rateTextOf(v, form.market_price) })

  return (
    <Modal title={editing ? '寄付を編集' : '寄付・候補を追加'} onClose={onClose}>
        <div className="row2">
          <label className="field">対象年（空欄=候補）
            <input type="text" inputMode="numeric" placeholder="例: 2026" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></label>
          <label className="field">寄付金額
            <input type="text" inputMode="numeric" value={form.price} onChange={(e) => setPrice(e.target.value)} /></label>
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
          <label className="field">
            市場価格
            <HelpTip title="還元率の考え方">
              同じ返礼品をAmazonや楽天市場などで買ったらいくらか（相場）を入れます。
              <br /><b>還元率 = 市場価格 ÷ 寄付金額</b>。どちらの欄に入れても、もう一方が自動で埋まります。
              <br />保存されるのは市場価格だけなので、あとで寄付金額を直すと還元率も自動で計算し直されます。
              <br />下の「相場を調べる」で商品名の検索ページを開き、設定タブのブックマークレットを押すと市場価格を取り込めます。
            </HelpTip>
            <input type="text" inputMode="numeric" value={form.market_price} onChange={(e) => setMarket(e.target.value)} /></label>
          <label className="field">還元率（%）
            <input type="text" inputMode="decimal" value={form.rate} onChange={(e) => setRate(e.target.value)} /></label>
        </div>
        <div style={{ display: 'flex', gap: 6, margin: '-4px 0 10px' }}>
          <button className="btn small secondary" style={{ marginTop: 0 }} disabled={!form.name.trim()} onClick={() => onSearchMarket('amazon')}>Amazonで相場を調べる</button>
          <button className="btn small secondary" style={{ marginTop: 0 }} disabled={!form.name.trim()} onClick={() => onSearchMarket('rakuten')}>楽天市場で調べる</button>
        </div>

        <label className="field">
          優先度
          <HelpTip title="優先度">
            5がいちばん欲しいもの。候補選定の点数計算に使います（未設定は3扱い）。
          </HelpTip>
          <div className="seg" style={{ marginTop: 4, marginBottom: 0 }}>
            {['1', '2', '3', '4', '5'].map((p) => (
              <button key={p} className={form.priority === p ? 'on' : ''} onClick={() => setForm({ ...form, priority: p })}>{p}</button>
            ))}
          </div>
        </label>

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

        <button className="btn" onClick={onSave} disabled={saving || !form.name.trim()}>{saving ? '保存中…' : editing ? '更新' : '追加'}</button>
        <button className="btn secondary" style={{ marginTop: 8 }} onClick={onClose}>キャンセル</button>
    </Modal>
  )
}
