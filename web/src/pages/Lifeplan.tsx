import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Chart, Line } from 'react-chartjs-2'
import HelpTip from '../components/HelpTip'
import { getConst } from '../constants'
import {
  annualLoanPayment,
  BASIC_PENSION_FULL,
  childAllowanceByIndex,
  childAnnualCost,
  estimateIncome,
  estimatePension,
  parseLifeplan,
  simulate,
  type LifeplanAdult,
  type LifeplanChild,
  type LifeplanConfig,
} from '../lifeplan'
import { useStore } from '../store'
import { DEFAULT_PERSONS } from '../types'
import { amt, assetTotal, parseBonusConfig, sortedAssets, yen, yenShort } from '../utils'

const thisYear = new Date().getFullYear()

const NEW_ADULT = (name: string): LifeplanAdult => ({
  name, birth_year: null, net_income: null, income_enabled: true, retire_age: 65, pension: 1_500_000, pension_start: 65,
})

const NEW_CHILD: LifeplanChild = {
  birth_year: thisYear, nursery: true, elementary: '公立', junior: '公立', high: '公立',
  path: '大卒', college: '国公立', living: '実家',
}

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[,，]/g, '')) || 0)

/** 小数を途中入力できる数値欄（「0.」「1.5」などの入力中も値が消えない） */
function DecimalField({ label, value, onChange, help }: { label: string; value: number; onChange: (v: number) => void; help?: ReactNode }) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    const p = parseFloat(text)
    if (Number.isNaN(p) ? value !== 0 : Math.abs(p - value) > 1e-9) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <label className="field">
      {label}
      {help}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const p = parseFloat(e.target.value)
          if (!Number.isNaN(p)) onChange(p)
        }}
      />
    </label>
  )
}

export default function Lifeplan() {
  const { data, mutate, saving } = useStore()
  const [cfg, setCfg] = useState<LifeplanConfig | null>(null)
  const [msg, setMsg] = useState('')

  const persons = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'furusato_persons')?.value
    const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_PERSONS
    return list.length ? list : DEFAULT_PERSONS
  }, [data])

  // 保存済み設定を初回だけ読み込み（大人が未設定なら管理者リストから雛形を作る）
  useEffect(() => {
    if (!data || cfg) return
    const saved = parseLifeplan(data.settings.find((s) => s.key === 'lifeplan_config')?.value)
    setCfg(saved.adults.length ? saved : { ...saved, adults: persons.map(NEW_ADULT) })
  }, [data, cfg, persons])

  // 年収の想定（給与データより・手取り/額面）: 今年→無ければ直近年
  // 管理者リストに無い名前（リネーム前の名前など）も cfg 側にあれば対象にする
  const estimatedIncome = useMemo(() => {
    const out: Record<string, { net: number; gross: number } | null> = {}
    const names = [...new Set([...persons, ...(cfg?.adults ?? []).map((a) => a.name)])]
    for (const p of names) {
      const all = (data?.furusato_salaries ?? []).filter((s) => s.person === p && s.gross)
      const years = [...new Set(all.map((s) => Number(s.year)))].sort((a, b) => b - a)
      const y = years.includes(thisYear) ? thisYear : years[0]
      if (!y) {
        out[p] = null
        continue
      }
      const info = (data?.furusato_years ?? []).find((r) => r.person === p && Number(r.year) === y)
      out[p] = estimateIncome(
        all.filter((s) => Number(s.year) === y),
        info?.bonus_base ?? null,
        parseBonusConfig(info?.bonus_config),
      )
    }
    return out
  }, [data, persons, cfg])

  // 開始資産の内訳（投資分は運用利回りが効く / 現金・年金は効かない）
  const latestSnapshot = useMemo(() => {
    const assets = sortedAssets(data?.assets ?? [])
    if (!assets.length) return null
    const a = assets[assets.length - 1]
    return { total: assetTotal(a), invest: a.investment ?? 0, liquid: (a.cash ?? 0) + (a.pension ?? 0) }
  }, [data])
  const latestAssets = latestSnapshot?.total ?? null

  const resolvedNet = useMemo(() => {
    const out: Record<string, number> = {}
    for (const a of cfg?.adults ?? []) out[a.name] = a.net_income ?? estimatedIncome[a.name]?.net ?? 0
    return out
  }, [cfg, estimatedIncome])

  // 年金の想定: 額面は給与データ由来、無ければ手入力手取り÷0.78で概算
  const pensionEstOf = (a: LifeplanAdult) => {
    const gross = estimatedIncome[a.name]?.gross ?? (a.net_income ? Math.round(a.net_income / getConst('net_to_gross')) : null)
    return estimatePension(gross, a.retire_age)
  }
  const resolvedPension = useMemo(() => {
    const out: Record<string, number> = {}
    for (const a of cfg?.adults ?? []) out[a.name] = a.pension ?? pensionEstOf(a)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, estimatedIncome])

  // 開始資産: 手動上書きがあれば最新スナップの投資割合で投資/現金に按分、無ければスナップそのまま
  const { startInvest, startLiquid } = useMemo(() => {
    const override = cfg?.start_assets_override ?? null
    if (override !== null) {
      const ratio = latestSnapshot && latestSnapshot.total > 0 ? latestSnapshot.invest / latestSnapshot.total : 0.7
      return { startInvest: override * ratio, startLiquid: override * (1 - ratio) }
    }
    return { startInvest: latestSnapshot?.invest ?? 0, startLiquid: latestSnapshot?.liquid ?? 0 }
  }, [cfg, latestSnapshot])
  const result = useMemo(
    () => (cfg ? simulate(cfg, startInvest, startLiquid, thisYear, resolvedNet, resolvedPension) : null),
    [cfg, startInvest, startLiquid, resolvedNet, resolvedPension],
  )

  if (!cfg || !result) return <p className="muted center">読み込み中…</p>

  const upd = (patch: Partial<LifeplanConfig>) => setCfg({ ...cfg, ...patch })
  const updAdult = (i: number, patch: Partial<LifeplanAdult>) =>
    upd({ adults: cfg.adults.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  const updChild = (i: number, patch: Partial<LifeplanChild>) =>
    upd({ children: cfg.children.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  const save = async () => {
    setMsg('')
    await mutate('setSetting', { row: { key: 'lifeplan_config', value: JSON.stringify(cfg) } })
    setMsg('設定を保存しました ✓')
  }

  const head = cfg.adults[0]
  const labels = result.rows.map((r) => {
    const age = head?.birth_year ? `(${r.year - head.birth_year})` : ''
    return `${r.year}${age}`
  })
  const tickOpts = { maxTicksLimit: 9, maxRotation: 0 as const }

  return (
    <>
      <div className="card">
        <h2>
          総資産の推移（{thisYear}〜{thisYear + 80}年）{head?.birth_year ? ' ※横軸カッコ内は' + head.name + 'の年齢' : ''}
          <HelpTip title="総資産の計算">
            毎年: 投資分 ×= (1＋運用利回り)、現金分 += 収入 − 支出。資産合計 = 投資分＋現金分。収入=給与・年金・カスタム収入・住宅ローン控除、支出=基本生活費＋子供費用＋カスタム支出＋住宅（毎年インフレ率分増加、住宅は実額）。<br />
            実質資産 = 名目資産 ÷ (1＋インフレ率)^経過年（今の価値に換算した「目減り後」の額）。<br />
            名目資産が減らない場合は運用益が収支の赤字を上回っています（運用利回り0で収支のみの推移を確認可）。
          </HelpTip>
        </h2>
        <div className="chart-box">
          <Line
            data={{
              labels,
              datasets: [
                { label: '名目資産', data: result.rows.map((r) => r.assetsNominal), borderColor: '#38bdf8', tension: 0.2, pointRadius: 0 },
                { label: '実質資産（今の価値）', data: result.rows.map((r) => r.assetsReal), borderColor: '#c084fc', borderDash: [6, 4], tension: 0.2, pointRadius: 0 },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              scales: { y: { ticks: { callback: (v) => yenShort(Number(v)) } }, x: { ticks: tickOpts } },
            }}
          />
        </div>
        {result.depletionYear !== null ? (
          <p className="neg" style={{ fontSize: 13, margin: '6px 0 0' }}>
            ⚠ このままだと {result.depletionYear}年（{head?.birth_year ? `${head.name} ${result.depletionYear - head.birth_year}歳` : ''}）に資産がマイナスになります
          </p>
        ) : (
          <p className="pos" style={{ fontSize: 13, margin: '6px 0 0' }}>✓ 80年後まで資産はマイナスになりません</p>
        )}
        <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
          実質資産 = インフレ率{cfg.inflation}%で今の価値に換算した額（計算式は見出しの「？」参照）
        </p>
      </div>

      <div className="card">
        <h2>
          年間の収入と支出（名目）
          <HelpTip title="このグラフの構成">
            上向きバー = 収入（緑=給与、青緑=年金）。下向きバー = 支出（基本生活費＋子供費用＋カスタム支出）。黄線 = 支出のうち子供費用（児童手当差引後）。
          </HelpTip>
        </h2>
        <div className="chart-box">
          <Chart
            type="bar"
            data={{
              labels,
              datasets: [
                { type: 'bar' as const, label: '給与', data: result.rows.map((r) => r.salary), backgroundColor: '#4ade80', stack: 'income' },
                { type: 'bar' as const, label: '年金', data: result.rows.map((r) => r.pension), backgroundColor: '#2dd4bf', stack: 'income' },
                { type: 'bar' as const, label: '支出', data: result.rows.map((r) => -r.expense), backgroundColor: '#f87171', stack: 'expense' },
                { type: 'line' as const, label: 'うち子供費用', data: result.rows.map((r) => -r.childCost), borderColor: '#fbbf24', pointRadius: 0, tension: 0.2, stack: 'child' },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              scales: { x: { stacked: true, ticks: tickOpts }, y: { stacked: true, ticks: { callback: (v) => yenShort(Number(v)) } } },
            }}
          />
        </div>
        <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
          退職を境に緑（給与）が消えて青緑（年金）だけになります。支出には基本生活費・子供費用・カスタム支出を含みます
        </p>
      </div>

      <div className="card">
        <h2>基本設定</h2>
        <div className="row2">
          <DecimalField label="実質インフレ率（%/年）" value={cfg.inflation} onChange={(v) => upd({ inflation: v })}
            help={<HelpTip title="インフレ率">支出（基本生活費・子供費用・カスタム支出）が毎年この率で増えます。例: 2%なら10年後の生活費は約1.22倍。「実質資産」の換算（名目資産÷(1+率)^経過年）にも使われます。小数入力可（例: 1.5）。</HelpTip>} />
          <DecimalField label="運用利回り（%/年）" value={cfg.invest_return} onChange={(v) => upd({ invest_return: v })}
            help={<HelpTip title="運用利回り">投資分（開始時点の投資額）にのみ毎年この率で複利が効きます。現金・年金には効きません。毎年の収支の黒字は現金として積み上がります（追加投資は考慮しない簡易版）。0にすると収支の積み上げだけの推移になります。</HelpTip>} />
        </div>
        <div className="row2">
          <DecimalField label="昇給率（%/年）" value={cfg.raise_rate} onChange={(v) => upd({ raise_rate: v })}
            help={<HelpTip title="昇給率">給与収入（手取り）が退職まで毎年この率で増える想定です。例: 0.1と入力すると毎年0.1%ずつ増加。</HelpTip>} />
          <DecimalField label="年金の上昇率（%/年）" value={cfg.pension_growth} onChange={(v) => upd({ pension_growth: v })}
            help={<HelpTip title="年金の上昇率">0 = 受給額が現在の額のまま増えない保守的な想定。年金は物価に完全には連動しない（マクロ経済スライド）ため控えめな値を推奨。物価連動を想定するならインフレ率と同じ値を入力。</HelpTip>} />
        </div>
        <div className="row2">
          <label className="field">基本生活費（年額・子供費用除く）
            <HelpTip title="基本生活費">家賃・食費・光熱費など世帯の年間支出（子供にかかる分は除く。子供費用は下の子供設定から自動計算）。現在価格で入力し、毎年インフレ率分増えていきます。</HelpTip>
            <input type="text" inputMode="numeric" value={cfg.living_cost} onChange={(e) => upd({ living_cost: Number(e.target.value.replace(/[,，]/g, '')) || 0 })} /></label>
          <DecimalField label="子供費用の倍率（標準=1.0）" value={cfg.child_multiplier} onChange={(v) => upd({ child_multiplier: v })}
            help={<HelpTip title="子供費用の倍率">内蔵の標準費用（子供カードの？参照）に掛ける係数。ご家庭の実感に合わせて 0.8〜1.2 程度で調整してください（児童手当は倍率をかけずにそのまま差し引きます）。</HelpTip>} />
        </div>
        <label className="field">開始資産（空欄=最新の記録を採用）
          <input type="text" inputMode="numeric" placeholder={latestAssets !== null ? `自動: ${amt(latestAssets)}` : ''}
            value={cfg.start_assets_override ?? ''} onChange={(e) => upd({ start_assets_override: numOrNull(e.target.value) })} /></label>
      </div>

      <div className="card">
        <h2>大人（収入・年金）</h2>
        {cfg.adults.map((a, i) => (
          <div key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined, paddingTop: i > 0 ? 10 : 0, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <select
                style={{ marginTop: 0, width: 'auto', flex: 1, fontWeight: 700 }}
                value={a.name}
                onChange={(e) => updAdult(i, { name: e.target.value })}
              >
                {[...new Set([a.name, ...persons])].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" style={{ width: 'auto', marginTop: 0 }} checked={a.income_enabled}
                  onChange={(e) => updAdult(i, { income_enabled: e.target.checked })} />
                収入を含める
              </label>
              <button className="btn danger small" onClick={() => upd({ adults: cfg.adults.filter((_, j) => j !== i) })}>✕</button>
            </div>
            {!persons.includes(a.name) && (
              <p className="neg" style={{ fontSize: 12, margin: '0 0 6px' }}>
                ⚠「{a.name}」は管理者リストに存在しません（名前変更前のデータ？）。上のセレクトで現在の管理者に変更して保存してください
              </p>
            )}
            <div className="row2">
              <label className="field">生年（西暦）
                <input type="text" inputMode="numeric" placeholder="例: 1995" value={a.birth_year ?? ''} onChange={(e) => updAdult(i, { birth_year: numOrNull(e.target.value) })} /></label>
              <label className="field">手取り年収（空欄=給与データから想定）
                <HelpTip title="手取り年収の想定">
                  収支タブの「月次給与」カードのデータから、手取り月平均（総支給−控除合計）×12 ＋ ボーナス想定×手取り率 で計算します。手入力があればそちらが優先されます。
                </HelpTip>
                <input type="text" inputMode="numeric"
                  placeholder={estimatedIncome[a.name] ? `想定: ${amt(estimatedIncome[a.name]!.net)}` : '給与データなし'}
                  value={a.net_income ?? ''} onChange={(e) => updAdult(i, { net_income: numOrNull(e.target.value) })} /></label>
            </div>
            <div className="row2">
              <label className="field">退職年齢
                <input type="text" inputMode="numeric" value={a.retire_age} onChange={(e) => updAdult(i, { retire_age: Number(e.target.value) || 0 })} /></label>
              <label className="field">年金（年額・空欄=想定）／受給開始年齢
                <HelpTip title="年金の想定式">
                  老齢基礎年金 {Math.round(BASIC_PENSION_FULL / 100) / 100}万円（2026年度満額）× min(加入年数,40)/40 ＋ 老齢厚生年金 ≒ 平均年収（額面）× 0.5481% × 加入年数。
                  加入年数 = 22歳〜退職（最大65歳）。額面は給与データから、無ければ手取り÷0.78で概算。ねんきん定期便の値があれば手入力が優先です。
                </HelpTip>
                <span style={{ display: 'flex', gap: 6 }}>
                  <input type="text" inputMode="numeric" placeholder={`想定: ${amt(pensionEstOf(a))}`}
                    value={a.pension ?? ''} onChange={(e) => updAdult(i, { pension: numOrNull(e.target.value) })} />
                  <input type="text" inputMode="numeric" style={{ flex: '0 0 70px' }} value={a.pension_start} onChange={(e) => updAdult(i, { pension_start: Number(e.target.value) || 0 })} />
                </span></label>
            </div>
            {a.birth_year === null && <p className="neg" style={{ fontSize: 12, margin: 0 }}>⚠ 生年が未入力のため計算から除外されています</p>}
          </div>
        ))}
        {persons.filter((p) => !cfg.adults.some((a) => a.name === p)).map((p) => (
          <button key={p} className="btn secondary small" style={{ marginRight: 6 }} onClick={() => upd({ adults: [...cfg.adults, NEW_ADULT(p)] })}>
            ＋ {p} を追加
          </button>
        ))}
      </div>

      <div className="card">
        <h2>
          子供（状況ごとに費用を自動計算）
          <HelpTip title="子供費用の標準額（年額・現在価格）">
            文科省「子供の学習費調査」等をもとにした概算（食費・衣類などの養育費込み）:
            <table>
              <tbody>
                <tr><td style={{ textAlign: 'left' }}>0〜2歳</td><td>60万</td><td>保育園あり +50万</td></tr>
                <tr><td style={{ textAlign: 'left' }}>3〜5歳</td><td colSpan={2}>70万（幼保無償化）</td></tr>
                <tr><td style={{ textAlign: 'left' }}>小学校</td><td>公立 90万</td><td>私立 220万</td></tr>
                <tr><td style={{ textAlign: 'left' }}>中学校</td><td>公立 115万</td><td>私立 205万</td></tr>
                <tr><td style={{ textAlign: 'left' }}>高校</td><td>公立 110万</td><td>私立 125万</td></tr>
                <tr><td style={{ textAlign: 'left' }}>大学(〜21歳)/大学院(〜23歳)</td><td>国公立 110万</td><td>私立 160万</td></tr>
                <tr><td style={{ textAlign: 'left' }}>＋大学時の住まい</td><td>実家 40万</td><td>一人暮らし 120万</td></tr>
              </tbody>
            </table>
            高校は2026年度からの授業料無償化（所得制限なし・私立支援上限45.7万円）を反映済み。高卒選択時は18歳以降0円。<br />
            <b>児童手当を自動で差引き</b>: 3歳未満 月1.5万 / 3歳〜18歳年度末 月1万 / 第3子以降 月3万（22歳年度末までの子を年齢順に数えて3人目以降。所得制限なし）。
          </HelpTip>
        </h2>
        {cfg.children.map((c, i) => {
          const age = thisYear - c.birth_year
          const allowance = childAllowanceByIndex(cfg.children, thisYear)[i]
          const netCost = childAnnualCost(age, c) * cfg.child_multiplier - allowance
          return (
            <div key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined, paddingTop: i > 0 ? 10 : 0, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <b style={{ flex: 1 }}>
                  子{i + 1}（{age >= 0 ? `今年${age}歳` : `${c.birth_year}年生まれ予定`}・今年の費用 {yen(netCost)}
                  {allowance > 0 && <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>（児童手当 −{yen(allowance)} 済）</span>}）
                </b>
                <button className="btn danger small" onClick={() => upd({ children: cfg.children.filter((_, j) => j !== i) })}>✕</button>
              </div>
              <div className="row2">
                <label className="field">生年（西暦）
                  <input type="text" inputMode="numeric" value={c.birth_year} onChange={(e) => updChild(i, { birth_year: Number(e.target.value) || thisYear })} /></label>
                <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                  <input type="checkbox" style={{ width: 'auto', marginTop: 0 }} checked={c.nursery} onChange={(e) => updChild(i, { nursery: e.target.checked })} />
                  保育園あり（0〜2歳）
                </label>
              </div>
              <div className="row2">
                <label className="field">小学校
                  <select value={c.elementary} onChange={(e) => updChild(i, { elementary: e.target.value as LifeplanChild['elementary'] })}>
                    <option>公立</option><option>私立</option></select></label>
                <label className="field">中学校
                  <select value={c.junior} onChange={(e) => updChild(i, { junior: e.target.value as LifeplanChild['junior'] })}>
                    <option>公立</option><option>私立</option></select></label>
              </div>
              <div className="row2">
                <label className="field">高校
                  <select value={c.high} onChange={(e) => updChild(i, { high: e.target.value as LifeplanChild['high'] })}>
                    <option>公立</option><option>私立</option></select></label>
                <label className="field">進路
                  <select value={c.path} onChange={(e) => updChild(i, { path: e.target.value as LifeplanChild['path'] })}>
                    <option>高卒</option><option>大卒</option><option>大学院</option></select></label>
              </div>
              {c.path !== '高卒' && (
                <div className="row2">
                  <label className="field">大学
                    <select value={c.college} onChange={(e) => updChild(i, { college: e.target.value as LifeplanChild['college'] })}>
                      <option>国公立</option><option>私立</option></select></label>
                  <label className="field">住まい（大学時）
                    <select value={c.living} onChange={(e) => updChild(i, { living: e.target.value as LifeplanChild['living'] })}>
                      <option>実家</option><option>一人暮らし</option></select></label>
                </div>
              )}
            </div>
          )
        })}
        <button className="btn secondary small" onClick={() => upd({ children: [...cfg.children, { ...NEW_CHILD }] })}>＋ 子供を追加</button>
        <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
          標準費用表と児童手当の詳細は見出しの「？」参照。「子供費用の倍率」で全体を調整できます。
        </p>
      </div>

      <div className="card">
        <h2>カスタム収支（車の買替・リフォーム・相続など）</h2>
        {cfg.custom_flows.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'end', marginBottom: 6, flexWrap: 'wrap' }}>
            <label className="field" style={{ marginBottom: 0, flex: '1 1 90px' }}>名前
              <input type="text" value={f.label} onChange={(e) => upd({ custom_flows: cfg.custom_flows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></label>
            <label className="field" style={{ marginBottom: 0, flex: '0 1 80px' }}>開始年
              <input type="text" inputMode="numeric" value={f.start_year} onChange={(e) => upd({ custom_flows: cfg.custom_flows.map((x, j) => (j === i ? { ...x, start_year: Number(e.target.value) || thisYear } : x)) })} /></label>
            <label className="field" style={{ marginBottom: 0, flex: '0 1 80px' }}>終了年
              <input type="text" inputMode="numeric" value={f.end_year} onChange={(e) => upd({ custom_flows: cfg.custom_flows.map((x, j) => (j === i ? { ...x, end_year: Number(e.target.value) || thisYear } : x)) })} /></label>
            <label className="field" style={{ marginBottom: 0, flex: '1 1 110px' }}>年額（−=支出）
              <input type="text" inputMode="numeric" value={f.annual} onChange={(e) => upd({ custom_flows: cfg.custom_flows.map((x, j) => (j === i ? { ...x, annual: Number(e.target.value.replace(/[,，]/g, '')) || 0 } : x)) })} /></label>
            <button className="btn danger small" style={{ marginBottom: 2 }} onClick={() => upd({ custom_flows: cfg.custom_flows.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn secondary small" onClick={() => upd({ custom_flows: [...cfg.custom_flows, { label: '', start_year: thisYear, end_year: thisYear, annual: -1_000_000 }] })}>
            ＋ 空の行
          </button>
          <button className="btn secondary small" onClick={() => upd({ custom_flows: [...cfg.custom_flows, { label: '親の介護', start_year: thisYear + 10, end_year: thisYear + 14, annual: -1_080_000 }] })}>
            ＋ 親の介護
          </button>
          <button className="btn secondary small" onClick={() => upd({ custom_flows: [...cfg.custom_flows, { label: '車の買替', start_year: thisYear + 5, end_year: thisYear + 5, annual: -2_500_000 }] })}>
            ＋ 車の買替
          </button>
          <HelpTip title="テンプレの目安">
            親の介護: 月9万円（在宅〜施設の中間的な自己負担の目安）×5年。年数・金額は各行で調整してください。
            公的介護保険で7〜9割は給付されるため、ここに入れるのは自己負担分です。医療費控除で一部戻る場合がありますが小さいため考慮していません。
            {'\n'}車の買替: 1回250万円。買い替えのたびに行を追加してください。
          </HelpTip>
        </div>
      </div>

      <div className="card">
        <h2>
          マイホーム購入
          <HelpTip title="マイホームの計算">
            購入年に頭金＋諸費用（物件価格の約7%）を支出。返済期間中は元利均等の年間返済額を支出。
            購入後は修繕・維持費（年額）を支出に加え、現在の家賃×12を支出から控除します（購入で家賃が消えるため）。
            住宅ローン控除は年末残高×0.7%（年上限内・簡易）を控除年数だけ収入側に加算します。
            金額は購入時点の実額として扱います（インフレは掛けません）。
          </HelpTip>
        </h2>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <input type="checkbox" style={{ width: 'auto', marginTop: 0 }} checked={cfg.home.enabled}
            onChange={(e) => upd({ home: { ...cfg.home, enabled: e.target.checked } })} />
          マイホーム購入をプランに反映する
        </label>
        {cfg.home.enabled && (
          <>
            <div className="row2">
              <label className="field">購入年
                <input type="text" inputMode="numeric" value={cfg.home.buy_year} onChange={(e) => upd({ home: { ...cfg.home, buy_year: Number(e.target.value) || thisYear } })} /></label>
              <label className="field">物件価格
                <input type="text" inputMode="numeric" value={cfg.home.price} onChange={(e) => upd({ home: { ...cfg.home, price: Number(e.target.value.replace(/[,，]/g, '')) || 0 } })} /></label>
            </div>
            <div className="row2">
              <label className="field">頭金
                <input type="text" inputMode="numeric" value={cfg.home.down_payment} onChange={(e) => upd({ home: { ...cfg.home, down_payment: Number(e.target.value.replace(/[,，]/g, '')) || 0 } })} /></label>
              <label className="field">借入額（住宅ローン）
                <input type="text" inputMode="numeric" value={cfg.home.loan_amount} onChange={(e) => upd({ home: { ...cfg.home, loan_amount: Number(e.target.value.replace(/[,，]/g, '')) || 0 } })} /></label>
            </div>
            <div className="row2">
              <DecimalField label="金利（%/年・固定）" value={cfg.home.interest_rate} onChange={(v) => upd({ home: { ...cfg.home, interest_rate: v } })} />
              <label className="field">返済年数
                <input type="text" inputMode="numeric" value={cfg.home.loan_years} onChange={(e) => upd({ home: { ...cfg.home, loan_years: Number(e.target.value) || 0 } })} /></label>
            </div>
            <div className="row2">
              <label className="field">現在の家賃（月額・購入後は控除）
                <input type="text" inputMode="numeric" value={cfg.home.current_rent_monthly} onChange={(e) => upd({ home: { ...cfg.home, current_rent_monthly: Number(e.target.value.replace(/[,，]/g, '')) || 0 } })} /></label>
              <label className="field">修繕・維持費（年額）
                <input type="text" inputMode="numeric" value={cfg.home.renovation_annual} onChange={(e) => upd({ home: { ...cfg.home, renovation_annual: Number(e.target.value.replace(/[,，]/g, '')) || 0 } })} /></label>
            </div>
            <label className="field">住宅ローン控除の年数（0=なし）
              <input type="text" inputMode="numeric" value={cfg.home.loan_deduction_years} onChange={(e) => upd({ home: { ...cfg.home, loan_deduction_years: Number(e.target.value) || 0 } })} /></label>
            <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
              年間返済額の目安: {yen(annualLoanPayment(cfg.home.loan_amount, cfg.home.interest_rate, cfg.home.loan_years))}／年
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>5年ごとのサマリ</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ fontSize: 12, borderCollapse: 'collapse', whiteSpace: 'nowrap', width: '100%' }}>
            <thead>
              <tr className="muted">
                <th style={{ padding: 4, textAlign: 'left' }}>年</th>
                {cfg.adults.filter((a) => a.birth_year).map((a) => <th key={a.name} style={{ padding: 4, textAlign: 'right' }}>{a.name}</th>)}
                {cfg.children.map((_, i) => <th key={`c${i}`} style={{ padding: 4, textAlign: 'right' }}>子{i + 1}</th>)}
                <th style={{ padding: 4, textAlign: 'right' }}>給与</th>
                <th style={{ padding: 4, textAlign: 'right' }}>年金</th>
                <th style={{ padding: 4, textAlign: 'right' }}>支出</th>
                <th style={{ padding: 4, textAlign: 'right' }}>収支</th>
                <th style={{ padding: 4, textAlign: 'right' }}>名目資産</th>
                <th style={{ padding: 4, textAlign: 'right' }}>実質資産</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.filter((r) => r.i % 5 === 0).map((r) => (
                <tr key={r.year} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 4 }}>{r.year}</td>
                  {r.ages.filter((a) => a.age !== null).map((a) => <td key={a.name} style={{ padding: 4, textAlign: 'right' }}>{a.age}歳</td>)}
                  {cfg.children.map((c, i) => {
                    const age = r.year - c.birth_year
                    return <td key={`c${i}`} style={{ padding: 4, textAlign: 'right' }}>{age >= 0 ? `${age}歳` : '−'}</td>
                  })}
                  <td style={{ padding: 4, textAlign: 'right' }}>{yenShort(r.salary)}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>{yenShort(r.pension)}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>{yenShort(r.expense)}</td>
                  <td style={{ padding: 4, textAlign: 'right' }} className={r.income - r.expense < 0 ? 'neg' : 'pos'}>
                    {r.income - r.expense >= 0 ? '+' : ''}{yenShort(r.income - r.expense)}
                  </td>
                  <td style={{ padding: 4, textAlign: 'right' }} className={r.assetsNominal < 0 ? 'neg' : ''}>{yenShort(r.assetsNominal)}</td>
                  <td style={{ padding: 4, textAlign: 'right' }} className={r.assetsReal < 0 ? 'neg' : ''}>{yenShort(r.assetsReal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button className="btn" onClick={() => void save()} disabled={saving} style={{ marginBottom: 12 }}>
        {saving ? '保存中…' : '設定を保存'}
      </button>
      {msg && <p className="pos center">{msg}</p>}
    </>
  )
}
