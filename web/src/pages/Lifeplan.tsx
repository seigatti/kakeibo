import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart, Line } from 'react-chartjs-2'
import HelpTip from '../components/HelpTip'
import { getConst } from '../constants'
import {
  DEFAULT_LIFEPLAN,
  childAllowanceByIndex,
  childAnnualCost,
  estimateIncome,
  estimatePension,
  lifeEvents,
  parseLifeplan,
  planHighlights,
  scenarioSummary,
  simulate,
  type LifeplanAdult,
  type LifeplanChild,
  type LifeplanConfig,
} from '../lifeplan'
import LifeplanEditor from './LifeplanEditor'
import ScenarioSurveyCard from './ScenarioSurveyCard'
import { useStore } from '../store'
import { DEFAULT_PERSONS } from '../types'
import { assetTotal, estimateLivingCost, parseBonusConfig, parseProfile, sortedAssets, yen, yenShort } from '../utils'

const thisYear = new Date().getFullYear()

const NEW_ADULT = (name: string): LifeplanAdult => ({
  name, birth_year: null, net_income: null, income_enabled: true, retire_age: 65, pension: 1_500_000, pension_start: 65,
})

export default function Lifeplan() {
  const { data, mutate, saving } = useStore()
  const [msg, setMsg] = useState('')
  const [planA, setPlanA] = useState('')  // 表示中のシナリオ名
  const [planB, setPlanB] = useState('')  // '' = 比較しない
  // 編集中の下書き（null = 閲覧モード）。originalName が null なら新規作成
  const [edit, setEdit] = useState<{ draft: LifeplanConfig; originalName: string | null } | null>(null)
  const [survey, setSurvey] = useState(false) // アンケート画面
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)

  const persons = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'furusato_persons')?.value
    const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_PERSONS
    return list.length ? list : DEFAULT_PERSONS
  }, [data])

  // 保存済みシナリオ（settings の lifeplan_scenarios にJSON保存）
  const scenarios = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'lifeplan_scenarios')?.value
    try {
      const v = raw ? (JSON.parse(raw) as Array<{ name: string; config: LifeplanConfig }>) : []
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }, [data])

  const persistScenarios = (list: Array<{ name: string; config: LifeplanConfig }>) =>
    mutate('setSetting', { row: { key: 'lifeplan_scenarios', value: JSON.stringify(list) } })

  // 旧「現在の設定」(lifeplan_config) しか無い場合は、シナリオ1件に移行する（後から改名可）
  const migrated = useRef(false)
  useEffect(() => {
    if (!data || migrated.current || scenarios.length > 0) return
    const raw = data.settings.find((s) => s.key === 'lifeplan_config')?.value
    if (!raw) return
    migrated.current = true
    const saved = parseLifeplan(raw)
    void persistScenarios([{ name: 'マイプラン', config: saved.adults.length ? saved : { ...saved, adults: persons.map(NEW_ADULT) } }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, scenarios, persons])

  // 表示対象（A）の既定は先頭のシナリオ
  useEffect(() => {
    if (scenarios.length === 0) return
    if (!scenarios.some((x) => x.name === planA)) setPlanA(scenarios[0].name)
  }, [scenarios, planA])

  // 表示・編集の対象になっている設定。編集中は下書き、そうでなければ A のシナリオ
  const cfg = useMemo(() => {
    if (edit) return edit.draft
    const sc = scenarios.find((x) => x.name === planA)
    return sc ? parseLifeplan(JSON.stringify(sc.config)) : null
  }, [edit, scenarios, planA])

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
  // 基本生活費の自動推定（未入力時に採用）。実支出には現在の子供費用が含まれるので差し引く
  const livingEstimate = useMemo(() => {
    if (!data) return null
    const allowances = childAllowanceByIndex(cfg?.children ?? [], thisYear)
    const childNow = (cfg?.children ?? []).reduce(
      (s, c, i) => s + childAnnualCost(thisYear - c.birth_year, c) * (cfg?.child_multiplier ?? 1) - allowances[i],
      0,
    )
    return estimateLivingCost(data, childNow)
  }, [data, cfg])
  const resolvedLiving = cfg?.living_cost ?? livingEstimate?.annual ?? 0

  const result = useMemo(
    () => (cfg ? simulate(cfg, startInvest, startLiquid, thisYear, resolvedNet, resolvedPension, resolvedLiving) : null),
    [cfg, startInvest, startLiquid, resolvedNet, resolvedPension, resolvedLiving],
  )

  // 比較対象のシミュレーション（同じ開始資産・収入前提で設定差だけを比較）
  // 保存シナリオを同じ開始資産・収入前提でシミュレート（設定差だけが結果差になる）
  const simScenario = useMemo(
    () => (name: string) => {
      const sc = scenarios.find((x) => x.name === name)
      if (!sc) return null
      const c = parseLifeplan(JSON.stringify(sc.config))
      return simulate(c, startInvest, startLiquid, thisYear, resolvedNet, resolvedPension, c.living_cost ?? resolvedLiving)
    },
    [scenarios, startInvest, startLiquid, resolvedNet, resolvedPension, resolvedLiving],
  )
  // A の結果（cfg は A のシナリオ）
  const resultA = useMemo(() => (planA ? simScenario(planA) : result), [planA, simScenario, result])
  const resultB = useMemo(() => (planB ? simScenario(planB) : null), [planB, simScenario])

  // シナリオがまだ無いときは作成を促す（アンケート画面・編集画面はこの前で分岐する）
  if (!cfg || !result) {
    if (!data) return <p className="muted center">読み込み中…</p>
    return (
      <div className="card">
        <h2>ライフプランのシナリオを作りましょう</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          収入・子供・住まいなどの前提を「シナリオ」として保存し、見比べる画面です。
          まずは1つ作ってください（あとから何度でも編集・複製できます）。
        </p>
        <button className="btn" style={{ marginBottom: 8 }} onClick={() => { setSurvey(true); setMsg('') }}>
          アンケートに答えて作る（かんたん）
        </button>
        <button className="btn secondary"
          onClick={() => startEdit({ ...DEFAULT_LIFEPLAN, adults: persons.map(NEW_ADULT) }, null)}>
          手入力で作る
        </button>
        {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
      </div>
    )
  }

  // 編集は下書きに対して行う
  const upd = (patch: Partial<LifeplanConfig>) =>
    setEdit((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e))
  const updAdult = (i: number, patch: Partial<LifeplanAdult>) =>
    upd({ adults: cfg.adults.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  const updChild = (i: number, patch: Partial<LifeplanChild>) =>
    upd({ children: cfg.children.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  // 世帯主: 設定タブの控除プロフィールで選んだ人。未設定なら生年のある先頭の大人
  const headPerson = parseProfile(data?.settings.find((x) => x.key === 'furusato_profile')?.value).head_person
  const head =
    cfg.adults.find((a) => a.name === headPerson && a.birth_year) ??
    cfg.adults.find((a) => a.birth_year) ??
    cfg.adults[0]
  const labels = result.rows.map((r) => {
    const age = head?.birth_year ? `(${r.year - head.birth_year})` : ''
    return `${r.year}${age}`
  })
  const tickOpts = { maxTicksLimit: 9, maxRotation: 0 as const }

  const deleteScenario = async (name: string) => {
    if (!window.confirm(`シナリオ「${name}」を削除しますか？`)) return
    await persistScenarios(scenarios.filter((s) => s.name !== name))
    if (planB === name) setPlanB('')
  }

  // 名称のみ変更（config は不変）
  const renameScenario = async () => {
    if (!renaming) return
    const to = renaming.to.trim()
    if (!to || to === renaming.from) {
      setRenaming(null)
      return
    }
    if (scenarios.some((s) => s.name === to)) {
      window.alert(`「${to}」はすでに存在します。別の名前にしてください。`)
      return
    }
    await persistScenarios(scenarios.map((s) => (s.name === renaming.from ? { ...s, name: to } : s)))
    if (planA === renaming.from) setPlanA(to)
    if (planB === renaming.from) setPlanB(to)
    setRenaming(null)
  }

  // 並び替え（index i を dir 方向へ）
  const moveScenario = async (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= scenarios.length) return
    const next = [...scenarios]
    ;[next[i], next[j]] = [next[j], next[i]]
    await persistScenarios(next)
  }

  // グラフ・サマリは A のシナリオを表示する
  const rA = resultA ?? result
  const nameA = planA
  const nameB = planB
  const lastA = rA.rows[rA.rows.length - 1]
  const lastB = resultB?.rows[resultB.rows.length - 1]
  const A_COLOR = '#38bdf8'
  const B_COLOR = '#fbbf24'
  const Chip = ({ color, dashed, text }: { color: string; dashed?: boolean; text: string }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, marginRight: 12 }}>
      <span style={{ width: 18, height: 0, borderTop: `3px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
      <span style={{ color }}>{text}</span>
    </span>
  )

  // ---- 編集・アンケート画面 ----
  const startEdit = (draft: LifeplanConfig, originalName: string | null) => {
    setEdit({ draft, originalName })
    setSurvey(false)
    setMsg('')
  }
  const cancelEdit = () => {
    setEdit(null)
    setMsg('編集をキャンセルしました')
  }
  /** name=null なら originalName を上書き、name があればその名前で保存（新規 or 別名） */
  const commitEdit = async (name: string | null) => {
    if (!edit) return
    const target = name ?? edit.originalName
    if (!target) return
    const exists = scenarios.some((x) => x.name === target)
    const next = exists
      ? scenarios.map((x) => (x.name === target ? { name: target, config: edit.draft } : x))
      : [...scenarios, { name: target, config: edit.draft }]
    await persistScenarios(next)
    setEdit(null)
    setPlanA(target)
    setMsg(`シナリオ「${target}」を保存しました ✓`)
  }

  if (edit) {
    return (
      <LifeplanEditor
        cfg={cfg}
        upd={upd}
        updAdult={updAdult}
        updChild={updChild}
        estimatedIncome={estimatedIncome}
        pensionEstOf={pensionEstOf}
        livingEstimate={livingEstimate}
        persons={persons}
        latestAssets={latestAssets}
        originalName={edit.originalName}
        saving={saving}
        onSave={(n) => void commitEdit(n)}
        onCancel={cancelEdit}
      />
    )
  }

  if (survey) {
    return (
      <ScenarioSurveyCard
        base={cfg}
        saving={saving}
        onSave={async (name, generated) => {
          const exists = scenarios.some((x) => x.name === name)
          const next = exists
            ? scenarios.map((x) => (x.name === name ? { name, config: generated } : x))
            : [...scenarios, { name, config: generated }]
          await persistScenarios(next)
          setSurvey(false)
          setPlanA(name)
          setMsg(`シナリオ「${name}」を作成しました ✓`)
        }}
        onApply={(generated) => startEdit(generated, null)}
        onCancel={() => { setSurvey(false); setMsg('') }}
      />
    )
  }

  const highlights = planHighlights(rA.rows, cfg)
  const events = lifeEvents(cfg, rA, thisYear)

  // 年表の色分け。暗い背景で読みやすい定番色を対象者ごとに固定順で割り当てる
  const ADULT_COLORS = ['#38bdf8', '#4ade80']
  const CHILD_COLORS = ['#fbbf24', '#c084fc', '#f472b6']
  const COMMON_COLOR = '#94a3b8'
  const whoColor = new Map<string, string>()
  cfg.adults.forEach((a, i) => whoColor.set(a.name, ADULT_COLORS[i % ADULT_COLORS.length]))
  cfg.children.forEach((_, i) => whoColor.set(`子${i + 1}`, CHILD_COLORS[i % CHILD_COLORS.length]))
  const eventColor = (e: { who: string | null; label: string }) =>
    e.label.startsWith('⚠') ? '#f87171' : (e.who ? whoColor.get(e.who) ?? COMMON_COLOR : COMMON_COLOR)
  const eventLegend = [
    ...[...whoColor.entries()].filter(([w]) => events.some((e) => e.who === w)).map(([who, color]) => ({ who, color })),
    ...(events.some((e) => e.who === null) ? [{ who: '世帯共通', color: COMMON_COLOR }] : []),
  ]

  return (
    <>
      <div className="card">
        <h2>
          シナリオ比較
          <HelpTip title="シナリオ比較">
            シナリオを作って見比べる画面です（例:「私立コース」「マイホーム購入」）。A に選んだシナリオがグラフ・表に出ます。
            比較を選ぶとグラフに黄色の破線でもう1本が重なり、80年後の資産と枯渇年を並べて確認できます。
            比較は同じ開始資産・収入前提で行うので、<b>設定の違いだけ</b>が結果の差になります。
          </HelpTip>
        </h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button className="btn small" style={{ width: 'auto' }} disabled={!planA}
            onClick={() => startEdit(parseLifeplan(JSON.stringify(cfg)), planA)}>
            ✎ 「{planA}」を編集
          </button>
          <button className="btn small secondary" style={{ width: 'auto' }} onClick={() => { setSurvey(true); setMsg('') }}>
            ＋ アンケートで新規作成
          </button>
          <button className="btn small secondary" style={{ width: 'auto' }}
            onClick={() => startEdit(parseLifeplan(JSON.stringify(cfg)), null)}>
            ＋ 手入力で新規作成
          </button>
        </div>
        {scenarios.length > 0 ? (
          <>
            <div className="row2">
              <label className="field">A（青の実線）
                <select value={planA} onChange={(e) => setPlanA(e.target.value)}>
                  {scenarios.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select></label>
              <label className="field">B（黄の破線）
                <select value={planB} onChange={(e) => setPlanB(e.target.value)}>
                  <option value="">（比較しない）</option>
                  {scenarios.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select></label>
            </div>
            <ul className="list">
              {scenarios.map((s, i) => (
                <li key={s.name} style={{ flexWrap: 'wrap', rowGap: 4 }}>
                  {renaming?.from === s.name ? (
                    <>
                      <input type="text" style={{ flex: '1 1 120px', marginTop: 0 }} value={renaming.to}
                        onChange={(e) => setRenaming({ from: s.name, to: e.target.value })} autoFocus />
                      <button className="btn small" style={{ width: 'auto' }} disabled={saving} onClick={() => void renameScenario()}>確定</button>
                      <button className="btn small secondary" onClick={() => setRenaming(null)}>取消</button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: '1 1 100px', fontSize: 13 }}>{s.name}</span>
                      <button className="btn small secondary" style={{ padding: '4px 8px' }} disabled={i === 0 || saving} onClick={() => void moveScenario(i, -1)} title="上へ">▲</button>
                      <button className="btn small secondary" style={{ padding: '4px 8px' }} disabled={i === scenarios.length - 1 || saving} onClick={() => void moveScenario(i, 1)} title="下へ">▼</button>
                      <HelpTip title={`条件: ${s.name}`} label="条件">
                        {scenarioSummary(s.config).map((line, k) => (
                          <div key={k} style={{ marginBottom: 2 }}>{line}</div>
                        ))}
                      </HelpTip>
                      <button className="btn small secondary" onClick={() => startEdit(parseLifeplan(JSON.stringify(s.config)), s.name)}>編集</button>
                      <button className="btn small secondary" onClick={() => setRenaming({ from: s.name, to: s.name })}>改名</button>
                      <button className="btn danger small" onClick={() => void deleteScenario(s.name)}>削除</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {resultB && lastB && (
              <div style={{ marginTop: 8 }}>
                <div className="kv">
                  <span className="muted">80年後の資産（A: {nameA}）</span><span style={{ color: A_COLOR }}>{yen(lastA.assetsNominal)}</span>
                </div>
                <div className="kv">
                  <span className="muted">80年後の資産（B: {nameB}）</span><span style={{ color: B_COLOR }}>{yen(lastB.assetsNominal)}</span>
                </div>
                <div className="kv" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span>差（B − A）</span>
                  <b className={lastB.assetsNominal - lastA.assetsNominal >= 0 ? 'pos' : 'neg'}>
                    {lastB.assetsNominal - lastA.assetsNominal >= 0 ? '+' : ''}{yen(lastB.assetsNominal - lastA.assetsNominal)}
                  </b>
                </div>
                <div className="kv">
                  <span className="muted">資産が尽きる年</span>
                  <span>
                    A: {rA.depletionYear ?? 'なし'} / B: {resultB.depletionYear ?? 'なし'}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            まだシナリオがありません。設定を変えて名前を付けて保存すると、あとから比較できます。
          </p>
        )}
      </div>


      <div className="card">
        <h2>
          主要指標: {nameA}
          <HelpTip title="主要指標について">
            金額はすべて名目（インフレ調整前）です。「実質」は今の価値に直した額。
            <br />ピーク＝80年間で名目資産が最大になる年。退職時点＝収入を含める大人が全員退職し終える年の資産。
            <br />生涯の収入−支出＝80年間の収入合計 − 支出合計（開始資産と運用益は含みません）。
          </HelpTip>
        </h2>
        <div className="kv"><span className="muted">資産のピーク（{highlights.peak.year}年）</span><b>{yen(highlights.peak.assets)}</b></div>
        {highlights.retireYear !== null && (
          <div className="kv">
            <span className="muted">退職時点（{highlights.retireYear}年）</span>
            <span className={(highlights.retireAssets ?? 0) < 0 ? 'neg' : ''}>{yen(highlights.retireAssets)}</span>
          </div>
        )}
        <div className="kv"><span className="muted">{thisYear + 80}年（名目）</span>
          <span className={highlights.last.assetsNominal < 0 ? 'neg' : ''}>{yen(highlights.last.assetsNominal)}</span></div>
        <div className="kv"><span className="muted">{thisYear + 80}年（実質・今の価値）</span>
          <span className={highlights.last.assetsReal < 0 ? 'neg' : ''}>{yen(highlights.last.assetsReal)}</span></div>
        <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
          <span className="muted">生涯の収入 − 支出</span>
          <b className={highlights.totalIncome - highlights.totalExpense >= 0 ? 'pos' : 'neg'}>
            {highlights.totalIncome - highlights.totalExpense >= 0 ? '+' : ''}{yen(highlights.totalIncome - highlights.totalExpense)}
          </b>
        </div>
        <div className="kv"><span className="muted">資産が尽きる年</span>
          <span className={rA.depletionYear !== null ? 'neg' : 'pos'}>{rA.depletionYear ?? 'なし'}</span></div>
      </div>

      <div className="card">
        <h2>
          総資産の推移: {nameA}{nameB ? ` vs ${nameB}` : ''}（{thisYear}〜{thisYear + 80}年）
          <HelpTip title="総資産の計算">
            毎年: 投資分 ×= (1＋運用利回り)、現金分 += 収入 − 支出。資産合計 = 投資分＋現金分。収入=給与・年金・カスタム収入・住宅ローン控除、支出=基本生活費＋子供費用＋カスタム支出＋住宅（毎年インフレ率分増加、住宅は実額）。<br />
            実質資産 = 名目資産 ÷ (1＋インフレ率)^経過年（今の価値に換算した「目減り後」の額）。<br />
            名目資産が減らない場合は運用益が収支の赤字を上回っています（運用利回り0で収支のみの推移を確認可）。
          </HelpTip>
        </h2>
        <div style={{ marginBottom: 6 }}>
          <Chip color={A_COLOR} text={`A: ${nameA}`} />
          {nameB
            ? <Chip color={B_COLOR} dashed text={`B: ${nameB}`} />
            : <Chip color="#c084fc" dashed text="実質資産（今の価値）" />}
          {head?.birth_year && <span className="muted" style={{ fontSize: 11 }}>※横軸カッコ内は{head.name}の年齢</span>}
        </div>
        <div className="chart-box">
          <Line
            data={{
              labels,
              datasets: [
                { label: `A: ${nameA}`, data: rA.rows.map((r) => r.assetsNominal), borderColor: A_COLOR, tension: 0.2, pointRadius: 0 },
                ...(resultB
                  ? [{ label: `B: ${nameB}`, data: resultB.rows.map((r) => r.assetsNominal), borderColor: B_COLOR, borderDash: [8, 4], tension: 0.2, pointRadius: 0 }]
                  : [{ label: '実質資産（今の価値）', data: rA.rows.map((r) => r.assetsReal), borderColor: '#c084fc', borderDash: [6, 4], tension: 0.2, pointRadius: 0 }]),
              ],
            }}
            options={{
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              scales: { y: { ticks: { callback: (v) => yenShort(Number(v)) } }, x: { ticks: tickOpts } },
            }}
          />
        </div>
        {rA.depletionYear !== null ? (
          <p className="neg" style={{ fontSize: 13, margin: '6px 0 0' }}>
            ⚠ {nameA}: このままだと {rA.depletionYear}年（{head?.birth_year ? `${head.name} ${rA.depletionYear - head.birth_year}歳` : ''}）に資産がマイナスになります
          </p>
        ) : (
          <p className="pos" style={{ fontSize: 13, margin: '6px 0 0' }}>✓ {nameA}: 80年後まで資産はマイナスになりません</p>
        )}
        <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
          実質資産 = インフレ率{cfg.inflation}%で今の価値に換算した額（計算式は見出しの「？」参照）
        </p>
      </div>

      <div className="card">
        <h2>
          資産の内訳推移（投資 / 現金）: {nameA}
          <HelpTip title="資産の内訳">
            投資分には運用利回りの複利が効き、現金分には効きません。
            <br />「収入のうち投資へ回す割合」を上げると毎年その分だけ現金から投資へ移るので、青（投資分）が厚くなります。
          </HelpTip>
        </h2>
        <div className="chart-box">
          <Chart
            type="bar"
            data={{
              labels,
              datasets: [
                { type: 'bar' as const, label: '投資分', data: rA.rows.map((r) => r.assetsInvest), backgroundColor: '#38bdf8', stack: 'a' },
                { type: 'bar' as const, label: '現金分', data: rA.rows.map((r) => r.assetsNominal - r.assetsInvest), backgroundColor: '#94a3b8', stack: 'a' },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              scales: { x: { stacked: true, ticks: tickOpts }, y: { stacked: true, ticks: { callback: (v) => yenShort(Number(v)) } } },
            }}
          />
        </div>
      </div>

      <div className="card">
        <h2>
          年間の収入と支出（名目）: {nameA}
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
                { type: 'bar' as const, label: '給与', data: rA.rows.map((r) => r.salary), backgroundColor: '#4ade80', stack: 'income' },
                { type: 'bar' as const, label: '年金', data: rA.rows.map((r) => r.pension), backgroundColor: '#2dd4bf', stack: 'income' },
                { type: 'bar' as const, label: '支出', data: rA.rows.map((r) => -r.expense), backgroundColor: '#f87171', stack: 'expense' },
                { type: 'line' as const, label: 'うち子供費用', data: rA.rows.map((r) => -r.childCost), borderColor: '#fbbf24', pointRadius: 0, tension: 0.2, stack: 'child' },
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
        <h2>
          支出の内訳推移: {nameA}
          <HelpTip title="支出の内訳">
            基本生活費・子供費用（児童手当の差引後）・その他（カスタム支出と住宅の純支出）の積み上げです。
            <br />3つの合計は「年間の収入と支出」の支出バーと一致します。
          </HelpTip>
        </h2>
        <div className="chart-box">
          <Chart
            type="bar"
            data={{
              labels,
              datasets: [
                { type: 'bar' as const, label: '基本生活費', data: rA.rows.map((r) => r.living), backgroundColor: '#fb923c', stack: 'e' },
                { type: 'bar' as const, label: '子供費用', data: rA.rows.map((r) => r.childCost), backgroundColor: '#fbbf24', stack: 'e' },
                { type: 'bar' as const, label: 'その他（カスタム・住宅）', data: rA.rows.map((r) => r.expense - r.living - r.childCost), backgroundColor: '#c084fc', stack: 'e' },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              scales: { x: { stacked: true, ticks: tickOpts }, y: { stacked: true, ticks: { callback: (v) => yenShort(Number(v)) } } },
            }}
          />
        </div>
      </div>

      {events.length > 0 && (
        <div className="card">
          <h2>
            ライフイベント年表: {nameA}
            <HelpTip title="年表について">
              設定から決まる予定（進学・卒業・住宅購入・ローン完済・退職・年金開始）と、
              シミュレーション結果から決まる年（資産のピーク・資産がマイナスになる年）をまとめたものです。
            </HelpTip>
          </h2>
          <div style={{ marginBottom: 6 }}>
            {eventLegend.map((l) => (
              <span key={l.who} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, marginRight: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
                <span style={{ color: l.color }}>{l.who}</span>
              </span>
            ))}
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
            <table style={{ fontSize: 12, borderCollapse: 'collapse', whiteSpace: 'nowrap', width: '100%' }}>
              <tbody>
                {events.map((e, i) => {
                  const subjAge = e.birthYear !== null ? e.year - e.birthYear : null
                  const headAge = head?.birth_year ? e.year - head.birth_year : null
                  const subjIsHead = e.who !== null && e.who === head?.name
                  return (
                    <tr key={`${e.year}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 4, width: 54 }}>{e.year}</td>
                      <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                        {subjAge !== null && <span style={{ color: eventColor(e) }}>{e.who} {subjAge}</span>}
                        {subjAge !== null && headAge !== null && !subjIsHead && <span className="muted"> / </span>}
                        {headAge !== null && !subjIsHead && <span className="muted">{head.name} {headAge}</span>}
                      </td>
                      <td style={{ padding: 4, color: eventColor(e) }}>{e.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            年齢は「対象者{head?.birth_year ? ` / 世帯主（${head.name}）` : ''}」の順。世帯主は設定タブの控除プロフィールで選んだ人です
          </p>
        </div>
      )}

      <div className="card">
        <h2>5年ごとのサマリ: {nameA}</h2>
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
              {rA.rows.filter((r) => r.i % 5 === 0).map((r) => (
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

      {msg && <p className="pos center">{msg}</p>}
    </>
  )
}
