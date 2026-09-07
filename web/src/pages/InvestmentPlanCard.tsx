import { useMemo, useState } from 'react'
import Collapsible from '../components/Collapsible'
import HelpTip from '../components/HelpTip'
import PickList from '../components/PickList'
import { useStore } from '../store'
import { investmentPlanOf, thisMonth, yen, type InvestmentPlanRow } from '../utils'

/**
 * 「現金から投資へ回している毎月の額」の設定。
 *
 * その他支出は `収入 − 固定費 − 変動費 − 非投資の資産増減` で出しており、
 * 非投資の資産増減には「現金から投資へ移した額」を足し戻す必要がある。
 * これを資産の差から逆算（Δ投資 − その月の投資増減）すると記録日のずれで月ごとに
 * 大きくブレるので、実際の積立額を設定して使えるようにする。
 */
export default function InvestmentPlanCard() {
  const { data, mutate, saving } = useStore()
  const [from, setFrom] = useState(thisMonth())
  const [amount, setAmount] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [msg, setMsg] = useState('')

  const plan = useMemo(() => (data ? investmentPlanOf(data) : []), [data])
  // 新しい順に見せる（直近の設定が上）
  const rows = useMemo(() => [...plan].reverse(), [plan])

  const persist = async (next: InvestmentPlanRow[]) => {
    const sorted = [...next].sort((a, b) => a.from.localeCompare(b.from))
    await mutate('setSetting', { row: { key: 'investment_plan', value: JSON.stringify(sorted) } })
  }

  const add = async () => {
    const n = Number(amount.replace(/[,，]/g, ''))
    if (!from || !Number.isFinite(n) || n < 0) return
    setMsg('')
    // 同じ開始月があれば置き換える
    await persist([...plan.filter((r) => r.from !== from), { from, amount: n }])
    setAmount('')
    setFormOpen(false)
    setMsg(`${from} から ${yen(n)}/月 で設定しました ✓`)
  }

  const remove = async (r: InvestmentPlanRow) => {
    if (!window.confirm(`${r.from} からの設定（${yen(r.amount)}/月）を削除しますか？`)) return
    setMsg('')
    await persist(plan.filter((x) => x.from !== r.from))
  }

  /** その行が適用される期間（次の行の手前まで） */
  const rangeOf = (r: InvestmentPlanRow) => {
    const i = plan.findIndex((x) => x.from === r.from)
    const next = plan[i + 1]
    return next ? `${r.from} 〜 ${next.from} の前月` : `${r.from} 以降`
  }

  return (
    <div className="card">
      <h2>
        毎月の積立額（現金から投資へ）
        <HelpTip title="毎月の積立額について">
          「その他支出」は <b>収入 − 固定費 − 変動費 − 非投資の資産増減</b> で出しています。
          このうち<b>現金から投資へ移した額</b>は支出ではないので足し戻す必要があり、
          設定が無いときは <b>Δ投資 − その月の投資増減</b> で逆算しています。
          {'\n'}ただし逆算は記録日のずれで月ごとに大きくブレる（実データで −36万〜+80万）ため、
          実際の積立額を入れておくと<b>その他支出が安定します</b>。設定した月は売買判定もしません。
          {'\n'}{'\n'}<b>入れるのは「現金（Zaim残高）から投資へ移した額」だけ</b>です。
          給与天引きの iDeCo・企業型DC・持株会は<b>含めないでください</b>
          （手取りに入っていないので、入れると二重に差し引かれます）。年金は元から計算に含めていません。
          {'\n'}金額を変えた時期があれば、開始月を分けて複数登録してください。
        </HelpTip>
      </h2>

      <Collapsible
        title="積立額を追加"
        hint={plan.length ? `${plan.length}件の設定` : '未設定（資産の差から逆算中）'}
        open={formOpen}
        onToggle={setFormOpen}
      >
        <div className="row2">
          <label className="field">開始月
            <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field">毎月の積立額
            <input type="text" inputMode="numeric" placeholder="例: 100000" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <button className="btn" onClick={() => void add()} disabled={saving || !amount.trim()}>
          {saving ? '保存中…' : '追加'}
        </button>
      </Collapsible>

      <PickList
        storageKey="kakeibo.listLimit.investmentPlan"
        rows={rows}
        keyOf={(r) => r.from}
        onPick={(r) => { setFrom(r.from); setAmount(String(r.amount)); setFormOpen(true); setMsg('') }}
        renderMain={(r) => (
          <>
            <span className="muted">{r.from} から</span>
            <span>{yen(r.amount)}/月</span>
          </>
        )}
        renderSub={(r) => `適用: ${rangeOf(r)} ・ 年 ${yen(r.amount * 12)}`}
        actions={(r) => <button className="btn danger small" onClick={() => void remove(r)}>削除</button>}
        empty="未設定です（その他支出は資産の差から逆算しています）"
      />

      {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}
