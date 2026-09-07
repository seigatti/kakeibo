import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import Collapsible from '../components/Collapsible'
import HelpTip from '../components/HelpTip'
import Modal from '../components/Modal'
import PickList from '../components/PickList'
import LoanTotalsCard from '../components/LoanTotalsCard'
import PeriodPicker, { inRange, usePeriod } from '../components/PeriodPicker'
import { useStore } from '../store'
import type { AssetRow } from '../types'
import { assetTotal, monthlyGainOf, sortedAssets, thisMonth, today, yen, yenShort } from '../utils'
import InvestmentPlanCard from './InvestmentPlanCard'
import LiabilityCard from './LiabilityCard'

const PREFILL_KEYS = ['investment', 'cash', 'pension', 'gain'] as const

// 全期間表示でも横軸ラベルが潰れないように間引く
const xTicks = { ticks: { maxTicksLimit: 12, maxRotation: 0 } }

export default function Assets({ prefill }: { prefill: URLSearchParams }) {
  const { data, mutate, saving } = useStore()
  const [date, setDate] = useState(today())
  const [investment, setInvestment] = useState('')
  const [cash, setCash] = useState('')
  const [pension, setPension] = useState('')
  const [gain, setGain] = useState('')
  const [memo, setMemo] = useState('')
  const [msg, setMsg] = useState('')
  // 入力欄は既定で畳んでおく。記録履歴の行を押したときは開いて中身を見せる
  const [formOpen, setFormOpen] = useState(false)
  // 日付変更の対象（モーダル）
  const [dateEdit, setDateEdit] = useState<{ row: AssetRow; to: string } | null>(null)
  const appliedPrefill = useRef<string | null>(null)

  const assets = useMemo(() => sortedAssets(data?.assets ?? []), [data])
  // 表示期間（このタブのグラフ共通。既定=全期間）
  const period = usePeriod(assets.length ? assets[0].date.slice(0, 7) : thisMonth())

  const num = (s: string | undefined) => (!s || s.trim() === '' ? null : Number(s.replace(/[,，]/g, '')))

  /** 指定日の既存記録をフォームへ反映。overrides（プリフィル値）があれば優先 */
  const applyRow = (d: string, overrides?: Partial<Record<(typeof PREFILL_KEYS)[number], string>>) => {
    const hit = assets.find((a) => a.date === d)
    setDate(d)
    setInvestment(overrides?.investment ?? hit?.investment?.toString() ?? '')
    setCash(overrides?.cash ?? hit?.cash?.toString() ?? '')
    setPension(overrides?.pension ?? hit?.pension?.toString() ?? '')
    setGain(overrides?.gain ?? (hit ? monthlyGainOf(hit)?.toString() ?? '' : ''))
    setMemo(hit?.memo ?? '')
  }

  /** 記録履歴の行を押したとき: その記録を読み込み、畳んでいる入力欄を開く */
  const editRow = (a: AssetRow) => {
    applyRow(a.date)
    setFormOpen(true)
    setMsg('')
  }

  // ブックマークレットからのプリフィル（#assets?investment=…&autosave=1 など）。
  // データ読み込み後に一度だけ適用し、autosave=1 なら既存の同日記録とマージして自動保存する。
  useEffect(() => {
    if (!data) return
    const key = prefill.toString()
    if (!key || appliedPrefill.current === key) return
    if (!PREFILL_KEYS.some((k) => prefill.get(k)) && !prefill.get('date')) return
    appliedPrefill.current = key

    const d = prefill.get('date') ?? today()
    const overrides: Partial<Record<(typeof PREFILL_KEYS)[number], string>> = {}
    for (const k of PREFILL_KEYS) if (prefill.get(k)) overrides[k] = prefill.get(k)!
    applyRow(d, overrides)
    setFormOpen(true)

    if (prefill.get('autosave') === '1') {
      const hit = assets.find((a) => a.date === d)
      const row = {
        date: d,
        investment: overrides.investment !== undefined ? num(overrides.investment) : (hit?.investment ?? null),
        cash: overrides.cash !== undefined ? num(overrides.cash) : (hit?.cash ?? null),
        pension: overrides.pension !== undefined ? num(overrides.pension) : (hit?.pension ?? null),
        // 旧「評価損益」列は統合済み。新しい列だけに書き、旧列は空にして片付ける
        mf_profit: null,
        monthly_gain: overrides.gain !== undefined ? num(overrides.gain) : (hit ? monthlyGainOf(hit) : null),
        memo: hit?.memo ?? '自動記録',
      }
      mutate('upsertAsset', { row })
        .then(() => {
          setMsg(`${d} に自動保存しました ✓`)
          history.replaceState(null, '', '#assets')
        })
        .catch(() => setMsg('自動保存に失敗しました。内容を確認して保存を押してください'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prefill])

  const filtered = useMemo(
    () => assets.filter((a) => inRange(a.date.slice(0, 7), period.from, period.to)),
    [assets, period.from, period.to],
  )

  /** 今月の投資増減（記録のある日付だけ）。旧「評価損益」列の履歴も monthlyGainOf で拾う */
  const gains = useMemo(
    () => filtered.map((a) => ({ date: a.date, v: monthlyGainOf(a) })).filter((g) => g.v !== null),
    [filtered],
  )

  const save = async () => {
    setMsg('')
    await mutate('upsertAsset', {
      row: {
        date,
        investment: num(investment),
        cash: num(cash),
        pension: num(pension),
        // 統合後は monthly_gain が正。旧列は null にして触った行から順に片付ける
        mf_profit: null,
        monthly_gain: num(gain),
        memo: memo || null,
      },
    })
    setMsg(`${date} の記録を保存しました`)
  }

  const remove = async (d: string) => {
    if (!window.confirm(`${d} の記録を削除しますか？`)) return
    await mutate('deleteAsset', { date: d })
  }

  /**
   * 記録の日付を変える。
   * @param move true なら移動（元を削除）、false ならコピー（元を残す）
   * 先に新しい日付へ作ってから元を消すので、途中で失敗しても記録が消えることはない。
   */
  const changeDate = async (row: AssetRow, to: string, move: boolean) => {
    if (!to || to === row.date) return
    const clash = assets.find((a) => a.date === to)
    if (clash && !window.confirm(`${to} には既に記録があります。上書きしますか？`)) return
    setMsg('')
    await mutate('upsertAsset', { row: { ...row, date: to } })
    if (move) await mutate('deleteAsset', { date: row.date })
    setDateEdit(null)
    setMsg(move ? `${row.date} を ${to} へ移動しました ✓` : `${row.date} を ${to} にコピーしました ✓`)
  }

  // 記録履歴（新しい順）。グローバルの history と紛れないよう histRows
  const histRows = useMemo(() => [...assets].reverse(), [assets])

  const lineOpts = {
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    scales: { y: { ticks: { callback: (v: unknown) => yenShort(Number(v)) } }, x: xTicks },
    spanGaps: true,
  }

  /** 記録履歴の2段目。値がある項目だけを並べる */
  const breakdownOf = (a: AssetRow) => {
    const parts: Array<{ k: string; v: number; cls?: string }> = []
    if (a.investment !== null) parts.push({ k: '投資', v: a.investment })
    if (a.cash !== null) parts.push({ k: '現金', v: a.cash })
    if (a.pension !== null) parts.push({ k: '年金', v: a.pension })
    const g = monthlyGainOf(a)
    if (g !== null) parts.push({ k: '増減', v: g, cls: g >= 0 ? 'pos' : 'neg' })
    return parts
  }

  return (
    <>
      <div className="card">
        <h2>資産を記録（過去日付もOK）</h2>
        <label className="field">日付<input type="date" value={date} onChange={(e) => applyRow(e.target.value)} /></label>
        <Collapsible
          title="金額を入力"
          hint={`投資 ${investment || '−'} / 現金 ${cash || '−'}`}
          open={formOpen}
          onToggle={setFormOpen}
        >
          <div className="row2">
            <label className="field">投資（マネフォ流動資産）
              <input type="text" inputMode="numeric" placeholder="例: 10070377" value={investment} onChange={(e) => setInvestment(e.target.value)} /></label>
            <label className="field">現金（Zaim残高）
              <input type="text" inputMode="numeric" placeholder="例: 2071561" value={cash} onChange={(e) => setCash(e.target.value)} /></label>
          </div>
          <div className="row2">
            <label className="field">年金
              <input type="text" inputMode="numeric" placeholder="任意" value={pension} onChange={(e) => setPension(e.target.value)} /></label>
            <label className="field">
              今月の投資増減
              <HelpTip title="今月の投資増減">
                マネーフォワードの総資産ページにある<b>「今月 +◯◯円」</b>の値です。
                前月からの投資額の増減（値動き）を表し、プラスにもマイナスにもなります。
                {'\n'}マネフォ用ブックマークレットで自動入力されます。
                {'\n'}以前は「評価損益」と2つに分かれていましたが、同じ値を指していたので1つにまとめました。
                過去に「評価損益」へ入れた分もそのまま引き継いで表示します。
              </HelpTip>
              <input type="text" inputMode="numeric" placeholder="任意（例: +72991）" value={gain} onChange={(e) => setGain(e.target.value)} /></label>
          </div>
          <label className="field">メモ<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        </Collapsible>
        <button className="btn" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
      </div>

      {assets.length > 0 && (
        <div className="card">
          <h2>記録履歴（新しい順）全{assets.length}件</h2>
          <PickList
            storageKey="kakeibo.assetHistoryLimit"
            rows={histRows}
            keyOf={(a) => a.date}
            selected={date}
            onPick={editRow}
            renderMain={(a) => (
              <>
                <span className="muted">{a.date}</span>
                <span>{yen(assetTotal(a))}</span>
              </>
            )}
            renderSub={(a) => breakdownOf(a).map((p, i) => (
              <span key={p.k}>
                {i > 0 && ' / '}
                {p.k} <span className={p.cls}>{p.k === '増減' && p.v >= 0 ? '+' : ''}{yenShort(p.v)}</span>
              </span>
            ))}
            actions={(a) => (
              <>
                <button className="btn small secondary" onClick={() => setDateEdit({ row: a, to: a.date })}>日付</button>
                <button className="btn danger small" onClick={() => void remove(a.date)}>削除</button>
              </>
            )}
          />
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            行をタップすると上の入力欄に読み込んで編集できます。「日付」から日付だけを変えた移動・コピーができます。
          </p>
        </div>
      )}

      <LiabilityCard />

      <LoanTotalsCard liabilities={data?.liabilities ?? []} />

      <InvestmentPlanCard />

      {/* 期間バーの sticky はこの div の中でだけ効く */}
      <div>
      {assets.length >= 2 && <PeriodPicker period={period} note="下の資産グラフ共通" />}

      {filtered.length >= 2 && (
        <div className="card">
          <h2>資産推移</h2>
          <div className="chart-box">
            <Line
              data={{
                labels: filtered.map((a) => a.date.slice(2, 10)),
                datasets: [
                  { label: '合計', data: filtered.map(assetTotal), borderColor: '#38bdf8', tension: 0.3 },
                  { label: '投資', data: filtered.map((a) => a.investment), borderColor: '#4ade80', tension: 0.3 },
                  { label: '現金', data: filtered.map((a) => a.cash), borderColor: '#fbbf24', tension: 0.3 },
                  { label: '年金', data: filtered.map((a) => a.pension), borderColor: '#c084fc', tension: 0.3 },
                ],
              }}
              options={lineOpts}
            />
          </div>
        </div>
      )}

      {gains.length >= 2 && (
        <div className="card">
          <h2>
            今月の投資増減の推移
            <HelpTip title="今月の投資増減の推移">
              マネフォの「今月 +◯◯円」＝前月からの投資額の増減です。記録した日付ごとに並べています。
              {'\n'}ホームのグラフでは月単位・年単位（その年の合計）に切り替えられます。
            </HelpTip>
          </h2>
          <div className="chart-box small">
            <Bar
              data={{
                labels: gains.map((g) => g.date.slice(2, 10)),
                datasets: [{
                  label: '今月の投資増減',
                  data: gains.map((g) => g.v),
                  backgroundColor: gains.map((g) => ((g.v ?? 0) >= 0 ? '#4ade80' : '#f87171')),
                }],
              }}
              options={{ ...lineOpts, plugins: { legend: { display: false } } }}
            />
          </div>
        </div>
      )}

      </div>

      {dateEdit && (
        <Modal title="日付を変更" onClose={() => setDateEdit(null)}>
          <div className="kv">
            <span className="muted">元の日付</span>
            <span>{dateEdit.row.date}（{yen(assetTotal(dateEdit.row))}）</span>
          </div>
          <label className="field" style={{ marginTop: 10 }}>新しい日付
            <input type="date" value={dateEdit.to} onChange={(e) => setDateEdit({ ...dateEdit, to: e.target.value })} /></label>
          {dateEdit.to !== dateEdit.row.date && assets.some((a) => a.date === dateEdit.to) && (
            <p className="neg" style={{ fontSize: 12, margin: '0 0 10px' }}>
              ⚠ {dateEdit.to} には既に記録があります。実行すると上書きされます
            </p>
          )}
          <div className="row2">
            <button className="btn secondary" style={{ marginTop: 0 }} disabled={saving || dateEdit.to === dateEdit.row.date}
              onClick={() => void changeDate(dateEdit.row, dateEdit.to, false)}>コピー（元を残す）</button>
            <button className="btn" style={{ marginTop: 0 }} disabled={saving || dateEdit.to === dateEdit.row.date}
              onClick={() => void changeDate(dateEdit.row, dateEdit.to, true)}>移動（元を削除）</button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
            投資・現金・年金・今月の投資増減・メモはそのまま引き継ぎます。
          </p>
        </Modal>
      )}
    </>
  )
}
