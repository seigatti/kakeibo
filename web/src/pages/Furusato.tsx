import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { APPLICATION_STATUSES, DEFAULT_PERSONS, type FurusatoItem, type FurusatoPerson } from '../types'
import { amt, estimateSalary, furusatoLimitDetailed, parseBonusConfig, parseProfile, yen } from '../utils'
import { getConst } from '../constants'
import {
  EMPTY_FILTER,
  PICK_MODES,
  averageRate,
  filterItems,
  isFilterActive,
  pickCandidates,
  priorityOf,
  returnRate,
  toNum,
  type ItemFilter,
  type PickMode,
} from '../furusato'
import Collapsible from '../components/Collapsible'
import HelpTip from '../components/HelpTip'
import ProfileCard from './ProfileCard'
import FurusatoItemModal, { EMPTY_ITEM, rateTextOf, type ItemForm } from './FurusatoItemModal'

/** 申請状況の色。進み具合が一目で分かるよう グレー→オレンジ→アンバー→スカイ→グリーン と進める */
const STATUS_COLORS: Record<string, string> = {
  未購入: 'var(--muted)',
  '購入済み、書類未': '#fb923c',
  ワンストップ未: 'var(--amber)',
  '手続き済、税額確認未': 'var(--accent)',
  完了: 'var(--green)',
}
const statusColor = (s: string | null) => STATUS_COLORS[s ?? ''] ?? 'var(--muted)'

/** 「相場を調べる」で開いた返礼品のid。別オリジンのページからは渡せないのでlocalStorage経由で受け渡す */
const MARKET_TARGET_KEY = 'kakeibo.furusatoMarketTarget'

/** シートの行を入力フォームの形に */
function formOf(it: FurusatoItem): ItemForm {
  const price = toNum(it.price)
  const market = toNum(it.market_price)
  return {
    id: it.id,
    year: toNum(it.year) ? String(toNum(it.year)) : '',
    name: it.name,
    price: price !== null ? String(price) : '',
    municipality: it.municipality ?? '',
    url: it.url ?? '',
    application_status: it.application_status ?? '未購入',
    application_method: it.application_method ?? '',
    receipt_status: it.receipt_status === '済' ? '済' : '未',
    memo: it.memo ?? '',
    market_price: market !== null ? String(market) : '',
    rate: rateTextOf(price !== null ? String(price) : '', market !== null ? String(market) : ''),
    priority: String(priorityOf(it)),
  }
}

/** 相場検索用に商品名を短く整える（【ふるさと納税】などの飾りを落とす） */
export function marketQuery(name: string): string {
  return name
    .replace(/[【\[][^】\]]*[】\]]/g, ' ')
    .replace(/ふるさと納税|返礼品|送料無料|訳あり/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

export default function Furusato({ prefill }: { prefill: URLSearchParams }) {
  const { data, mutate, saving } = useStore()
  const [personState, setPersonState] = useState<FurusatoPerson>(localStorage.getItem('kakeibo.furusatoPerson') || '')
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [form, setForm] = useState<ItemForm>(EMPTY_ITEM)
  const [editing, setEditing] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [filter, setFilter] = useState<ItemFilter>(EMPTY_FILTER)
  const [searchOpen, setSearchOpen] = useState(false)
  const [pickMode, setPickMode] = useState<PickMode>('priority')
  const [marginText, setMarginText] = useState('10000')
  const [yearForm, setYearForm] = useState({
    income: '', social_insurance: '', medical_deduction: '', limit_manual: '',
    life_paid: '', quake_paid: '', medical_paid: '',
  })
  const [msg, setMsg] = useState('')
  const [limitOpen, setLimitOpen] = useState(false)
  const appliedPrefill = useRef<string | null>(null)

  // 管理者リスト（settings の furusato_persons、既定は せ,あ）
  const persons = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'furusato_persons')?.value
    const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_PERSONS
    return list.length ? list : DEFAULT_PERSONS
  }, [data])
  const person = persons.includes(personState) ? personState : persons[0]

  const items = useMemo(() => (data?.furusato_items ?? []).filter((i) => i.person === person), [data, person])
  const years = useMemo(() => data?.furusato_years ?? [], [data])
  const yearInfo = years.find((y) => y.person === person && Number(y.year) === year)

  const selectPerson = (p: FurusatoPerson) => {
    setPersonState(p)
    localStorage.setItem('kakeibo.furusatoPerson', p)
  }

  // 年・人の切替で上限フォームへ既存値を反映
  useEffect(() => {
    setYearForm({
      income: yearInfo?.income?.toString() ?? '',
      social_insurance: yearInfo?.social_insurance?.toString() ?? '',
      medical_deduction: yearInfo?.medical_deduction?.toString() ?? '',
      limit_manual: yearInfo?.limit_manual?.toString() ?? '',
      life_paid: yearInfo?.life_paid?.toString() ?? '',
      quake_paid: yearInfo?.quake_paid?.toString() ?? '',
      medical_paid: yearInfo?.medical_paid?.toString() ?? '',
    })
  }, [yearInfo])

  // ブックマークレットからのプリフィル。いずれも保存はせず、確認できるよう編集モーダルを開く
  //  ・楽天:   #furusato?name=…&price=…&url=…&municipality=…  → 新規追加として開く
  //  ・相場:   #furusato?market=…                              → 直前に「相場を調べる」した返礼品を開く
  useEffect(() => {
    const key = prefill.toString()
    if (!key || appliedPrefill.current === key) return

    const market = prefill.get('market')
    if (market) {
      appliedPrefill.current = key
      const targetId = localStorage.getItem(MARKET_TARGET_KEY)
      const target = targetId ? (data?.furusato_items ?? []).find((i) => String(i.id) === targetId) : undefined
      if (target) {
        setForm({ ...formOf(target), market_price: market, rate: rateTextOf(String(toNum(target.price) ?? ''), market) })
        setEditing(true)
        setModalOpen(true)
        setMsg(`市場価格 ${amt(Number(market))} を読み取りました。内容を確認して保存してください`)
      } else {
        setMsg('相場の取り込み先が分かりませんでした。編集画面の「相場を調べる」から開き直してください')
      }
      history.replaceState(null, '', '#furusato')
      return
    }

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
    setModalOpen(true)
    setMsg('楽天ページから読み取りました。内容を確認して保存してください')
    history.replaceState(null, '', '#furusato')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, data])

  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[,，]/g, '')))

  // 月次給与からの想定（保存済みのボーナス設定を使用）
  const salaryEst = useMemo(
    () =>
      estimateSalary(
        (data?.furusato_salaries ?? []).filter((s) => s.person === person && Number(s.year) === year),
        yearInfo?.bonus_base ?? null,
        parseBonusConfig(yearInfo?.bonus_config),
      ),
    [data, person, year, yearInfo],
  )
  const socialEstimated = salaryEst && salaryEst.annualSocial > 0 ? salaryEst.annualSocial : null
  // 社会保険料・年収: 手動入力が無ければ月次給与からの想定値を自動採用（手動優先方式）
  const socialAdopted = num(yearForm.social_insurance) ?? socialEstimated
  const usingEstimatedSocial = num(yearForm.social_insurance) === null && socialEstimated !== null
  const incomeEstimated = salaryEst?.annualIncome ?? null
  const incomeAdopted = num(yearForm.income) ?? incomeEstimated
  const usingEstimatedIncome = num(yearForm.income) === null && incomeEstimated !== null

  // 世帯控除プロフィール（世帯で1つ。家族系控除は世帯主にのみ適用）
  const profile = useMemo(() => parseProfile(data?.settings.find((s) => s.key === 'furusato_profile')?.value), [data])
  const isHead = profile.head_person !== null && profile.head_person === person

  const detailed = furusatoLimitDetailed({
    income: incomeAdopted,
    year,
    social: socialAdopted,
    lifePaid: num(yearForm.life_paid),
    quakePaid: num(yearForm.quake_paid),
    medicalPaid: num(yearForm.medical_paid),
    medicalDeductionOverride: num(yearForm.medical_deduction),
    spouse: isHead ? profile.spouse : false,
    dependentAges: isHead ? profile.dependents.map((d) => year - d.birth_year) : [],
    loanAnnualDeduction: isHead && profile.housing_loan.enabled ? profile.housing_loan.annual_deduction : null,
  })
  const limitAuto = detailed?.limit ?? null
  const limitAdopted = num(yearForm.limit_manual) ?? limitAuto
  const purchased = items.filter((i) => Number(i.year) === year && i.application_status !== '未購入' && i.price)
  const purchasedTotal = purchased.reduce((s, i) => s + (i.price ?? 0), 0)
  const remaining = limitAdopted !== null ? limitAdopted - purchasedTotal : null

  const yearItems = items.filter((i) => Number(i.year) === year && i.application_status !== '未購入')
  const candidates = items.filter((i) => !i.year || i.application_status === '未購入')

  // 検索（年をまたいで全件から絞り込む。条件が空なら通常の2リスト表示に戻す）
  const searching = isFilterActive(filter)
  const found = useMemo(() => filterItems(items, filter), [items, filter])

  // 候補の自動提案。予算 = 採用上限 − 購入済み合計 − 安全マージン
  const stdRate = getConst('furusato_std_rate') / 100
  const margin = Math.max(0, num(marginText) ?? 0)
  const budget = remaining !== null ? remaining - margin : null
  const pick = useMemo(
    () => (budget === null ? null : pickCandidates(candidates, budget, pickMode, stdRate)),
    // candidates は毎回作り直されるので items ベースで依存を張る
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, budget, pickMode, stdRate],
  )

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
        life_paid: num(yearForm.life_paid),
        quake_paid: num(yearForm.quake_paid),
        medical_paid: num(yearForm.medical_paid),
        memo: yearInfo?.memo ?? null,
        // ボーナス設定は給与カード側で管理しているため既存値を保全する
        bonus_base: yearInfo?.bonus_base ?? null,
        bonus_config: yearInfo?.bonus_config ?? null,
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
        market_price: num(form.market_price),
        priority: num(form.priority),
      },
    })
    setForm({ ...EMPTY_ITEM, year: String(year) })
    setEditing(false)
    setModalOpen(false)
    setMsg(editing ? '更新しました ✓' : '追加しました ✓')
  }

  const editItem = (it: FurusatoItem) => {
    setForm(formOf(it))
    setEditing(true)
    setModalOpen(true)
    setMsg('')
  }

  const addItem = () => {
    setForm({ ...EMPTY_ITEM, year: String(year) })
    setEditing(false)
    setModalOpen(true)
    setMsg('')
  }

  // 相場検索: 商品名で検索ページを開き、どの返礼品向けかを控える
  // （別オリジンのページからは渡せないので、ブックマークレットが戻ってきたときにここを見る）
  const searchMarket = (site: 'amazon' | 'rakuten') => {
    const q = encodeURIComponent(marketQuery(form.name))
    if (form.id) localStorage.setItem(MARKET_TARGET_KEY, form.id)
    else localStorage.removeItem(MARKET_TARGET_KEY)
    const url = site === 'amazon' ? `https://www.amazon.co.jp/s?k=${q}` : `https://search.rakuten.co.jp/search/mall/${q}/`
    window.open(url, '_blank', 'noopener')
  }

  const removeItem = async (it: FurusatoItem) => {
    if (!window.confirm(`「${it.name.slice(0, 30)}…」を削除しますか？`)) return
    await mutate('deleteFurusatoItem', { id: it.id })
  }

  /** @param showYear 年をまたいで並べるとき（検索結果・候補）に対象年バッジを出す */
  const ItemList = ({ list, showYear }: { list: FurusatoItem[]; showYear?: boolean }) => (
    <ul className="list">
      {list.map((it) => {
        const rate = returnRate(it)
        const received = it.receipt_status === '済'
        const y = toNum(it.year)
        return (
          <li key={it.id} style={{ flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 100%', fontSize: 13 }}>
              {it.url ? (
                <a href={it.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{it.name.slice(0, 45)}{it.name.length > 45 ? '…' : ''}</a>
              ) : (
                <>{it.name.slice(0, 45)}{it.name.length > 45 ? '…' : ''}</>
              )}
            </span>
            <span style={{ flex: '1 1 100%', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              {showYear && <span className="badge" style={{ color: 'var(--muted)' }}>{y ? `${y}年` : '候補'}</span>}
              <span className="badge" style={{ color: statusColor(it.application_status) }}>{it.application_status ?? '未購入'}</span>
              <span className="badge" style={{ color: received ? 'var(--green)' : 'var(--red)' }}>{received ? '受取済' : '受取未'}</span>
              {rate !== null && <span className="badge" style={{ color: 'var(--accent)' }}>還元 {Math.round(rate * 1000) / 10}%</span>}
              <span className="badge" style={{ color: 'var(--muted)' }}>優先 {priorityOf(it)}</span>
            </span>
            <span className="muted" style={{ fontSize: 12, flex: 1 }}>
              {it.municipality ?? ''} {toNum(it.price) !== null ? yen(toNum(it.price)!) : ''}
            </span>
            <button className="btn small secondary" onClick={() => editItem(it)}>編集</button>
            <button className="btn danger small" onClick={() => void removeItem(it)}>削除</button>
          </li>
        )
      })}
      {list.length === 0 && <li className="muted">なし</li>}
    </ul>
  )

  return (
    <>
      <div className="seg">
        {persons.map((p) => (
          <button key={p} className={person === p ? 'on' : ''} onClick={() => selectPerson(p)}>{p}</button>
        ))}
        <select style={{ flex: 1, marginTop: 0, width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {allYears.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
      </div>

      <div className="card">
        <h2>{year}年の上限額（{person}）</h2>
        <div className="kv">
          <span className="muted">
            採用上限
            <HelpTip title="上限額の決まり方">
              優先順位: ①「上限の手動指定」（税額通知書ベースの正確な値）→ ②計算値。<br />
              計算式（総務省の標準式）: 上限 = 住民税所得割 × 20% ÷ (90% − 所得税率 × 1.021) + 2,000円。
              住民税所得割 = (給与所得 − 各種控除) × 10% から住宅ローン控除（住民税側）を差引き。千円未満切捨て。
            </HelpTip>
          </span>
          <span className="big" style={{ fontSize: 20 }}>{limitAdopted !== null ? yen(limitAdopted) : '未設定'}</span>
        </div>
        <div className="kv"><span className="muted">購入済み合計（{purchased.length}件）</span><span>{yen(purchasedTotal)}</span></div>
        <div className="kv" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <span>追加可能額</span>
          <span className={remaining !== null && remaining < 0 ? 'neg' : 'pos'}>{remaining !== null ? yen(remaining) : '−'}</span>
        </div>
        <Collapsible title="上限の計算・入力（年収・社会保険料など）" defaultOpen={limitOpen} onToggle={setLimitOpen}
          hint={limitAdopted !== null ? `採用上限 ${yen(limitAdopted)}` : '未設定'}>
          <div className="row2" style={{ marginTop: 8 }}>
            <label className="field">
              年収（額面・空欄なら想定を採用）
              <HelpTip title="年収の自動採用">
                空欄の場合、収支タブの「月次給与」カードに入力した給与から額面年収を想定して使います（未入力月は平均で補完＋ボーナス想定）。手入力があればそちらが優先されます。
              </HelpTip>
              <input type="text" inputMode="numeric"
                placeholder={incomeEstimated !== null ? `想定: ${amt(incomeEstimated)}` : ''}
                value={yearForm.income} onChange={(e) => setYearForm({ ...yearForm, income: e.target.value })} /></label>
            <label className="field">
              社会保険料（年額・空欄なら想定を採用）
              <HelpTip title="社会保険料の自動採用">
                空欄の場合、月次給与の健康保険・厚生年金・雇用保険から年額を想定して使います（平均月社保×12＋賞与分の概算）。手入力優先。
              </HelpTip>
              <input type="text" inputMode="numeric"
                placeholder={socialEstimated !== null ? `想定: ${amt(socialEstimated)}` : ''}
                value={yearForm.social_insurance} onChange={(e) => setYearForm({ ...yearForm, social_insurance: e.target.value })} /></label>
          </div>
          <div className="row2">
            <label className="field">
              生命保険料 支払額（年）
              <HelpTip title="生命保険料控除">
                新制度・一般生命保険のみの簡易計算。所得税側: 〜2万円全額 / 〜4万円 半額+1万 / 〜8万円 1/4+2万 / 上限4万円。
                住民税側: 〜1.2万円全額 / 〜3.2万円 半額+0.6万 / 〜5.6万円 1/4+1.4万 / 上限2.8万円。
              </HelpTip>
              <input type="text" inputMode="numeric" value={yearForm.life_paid} onChange={(e) => setYearForm({ ...yearForm, life_paid: e.target.value })} /></label>
            <label className="field">
              地震保険料 支払額（年）
              <HelpTip title="地震保険料控除">所得税側: 支払額そのまま（上限5万円）。住民税側: 支払額の半分（上限2.5万円）。</HelpTip>
              <input type="text" inputMode="numeric" value={yearForm.quake_paid} onChange={(e) => setYearForm({ ...yearForm, quake_paid: e.target.value })} /></label>
          </div>
          <div className="row2">
            <label className="field">
              医療費 支払額（年）
              <HelpTip title="医療費控除">控除額 = 支払額 −「10万円 or 給与所得の5%の小さい方」（マイナスなら0）。保険金で補填された分は支払額から除いて入力してください。</HelpTip>
              <input type="text" inputMode="numeric" value={yearForm.medical_paid} onChange={(e) => setYearForm({ ...yearForm, medical_paid: e.target.value })} /></label>
            <label className="field">医療費控除額の直接指定（任意・優先）
              <input type="text" inputMode="numeric"
                placeholder={detailed && num(yearForm.medical_paid) ? `自動計算: ${amt(Math.round(detailed.breakdown.medical))}` : ''}
                value={yearForm.medical_deduction} onChange={(e) => setYearForm({ ...yearForm, medical_deduction: e.target.value })} /></label>
          </div>
          <label className="field">上限の手動指定（最優先）
            <input type="text" inputMode="numeric" placeholder={limitAuto ? `計算値: ${amt(limitAuto)}` : ''} value={yearForm.limit_manual} onChange={(e) => setYearForm({ ...yearForm, limit_manual: e.target.value })} /></label>
          <p className="muted" style={{ fontSize: 12 }}>
            計算上限（目安）: <b>{limitAuto !== null ? yen(limitAuto) : '年収を入力するか、収支タブで給与を入力してください'}</b><br />
            {usingEstimatedIncome && (
              <>※年収は月次給与からの想定値（{yen(incomeEstimated)}）を使用中<br /></>
            )}
            {usingEstimatedSocial && (
              <>※社会保険料は月次給与からの想定値（{yen(socialEstimated)}）を使用中<br /></>
            )}
            {profile.head_person && !isHead && (
              <>※配偶者・扶養・住宅ローン控除は世帯主（{profile.head_person}）の計算にのみ適用されます<br /></>
            )}
            ※配偶者特別控除・調整控除などは省略した目安です。税額通知書などで正確な値が分かったら「手動指定」に入れてください。
          </p>
          {detailed && (
            <Collapsible title="計算の内訳を表示">
              <div style={{ fontSize: 12, marginTop: 6 }}>
                <div className="kv"><span className="muted">給与所得（収入−給与所得控除）</span><span>{yen(detailed.breakdown.shotoku)}</span></div>
                <div className="kv"><span className="muted">社会保険料控除</span><span>{yen(detailed.breakdown.social)}</span></div>
                {detailed.breakdown.life.it > 0 && (
                  <div className="kv"><span className="muted">生命保険料控除（所得税/住民税）</span><span>{yen(detailed.breakdown.life.it)} / {yen(detailed.breakdown.life.rt)}</span></div>
                )}
                {detailed.breakdown.quake.it > 0 && (
                  <div className="kv"><span className="muted">地震保険料控除（所得税/住民税）</span><span>{yen(detailed.breakdown.quake.it)} / {yen(detailed.breakdown.quake.rt)}</span></div>
                )}
                {detailed.breakdown.medical > 0 && (
                  <div className="kv"><span className="muted">医療費控除</span><span>{yen(detailed.breakdown.medical)}</span></div>
                )}
                {detailed.breakdown.spouse.it > 0 && (
                  <div className="kv"><span className="muted">配偶者控除（所得税/住民税）</span><span>{yen(detailed.breakdown.spouse.it)} / {yen(detailed.breakdown.spouse.rt)}</span></div>
                )}
                {detailed.breakdown.dependents.map((d, i) => (
                  <div className="kv" key={i}><span className="muted">扶養控除 {d.age}歳（{d.label}）</span><span>{d.it > 0 ? `${yen(d.it)} / ${yen(d.rt)}` : '0円'}</span></div>
                ))}
                <div className="kv">
                  <span className="muted">
                    基礎控除（所得税/住民税）
                    <HelpTip title="基礎控除（2025・2026年税制改正対応）">
                      所得税側は対象年と所得で変動: 〜2024年=48万 / 2025・26年=所得により95・88・68・63万＋本則（2026年は62万） / 2027年〜=132万円以下95万・他62万。住民税側は43万円で据え置き。
                    </HelpTip>
                  </span>
                  <span>{yen(detailed.breakdown.basicIT)} / {yen(430000)}</span>
                </div>
                <div className="kv"><span className="muted">課税所得（所得税/住民税）</span><span>{yen(detailed.breakdown.taxableIT)} / {yen(detailed.breakdown.taxableRT)}</span></div>
                <div className="kv"><span className="muted">所得税額（税率{Math.round(detailed.breakdown.rate * 100)}%）</span><span>{yen(detailed.breakdown.incomeTax)}</span></div>
                <div className="kv"><span className="muted">住民税所得割</span><span>{yen(detailed.breakdown.residentTax)}</span></div>
                {detailed.breakdown.loanResident > 0 && (
                  <div className="kv"><span className="muted">住宅ローン控除（住民税側）</span><span className="neg">−{yen(detailed.breakdown.loanResident)}</span></div>
                )}
              </div>
            </Collapsible>
          )}
          <button className="btn" onClick={() => void saveYear()} disabled={saving}>{saving ? '保存中…' : '上限情報を保存'}</button>
        </Collapsible>
      </div>

      <ProfileCard persons={persons} year={year} profile={profile} />

      <p className="muted" style={{ fontSize: 12, margin: '0 4px 12px' }}>
        💡 月次給与の入力カードは<b>収支タブ</b>へ移動しました（入力した給与はこのページの上限計算にも自動で使われます）
      </p>

      <button className="btn" style={{ marginBottom: 12 }} onClick={addItem}>＋ 寄付・候補を追加</button>
      {msg && <p className="pos center" style={{ margin: '-4px 0 12px' }}>{msg}</p>}

      <div className="card">
        <Collapsible title="🔍 検索" defaultOpen={searchOpen} onToggle={setSearchOpen}
          hint={searching ? `${found.length}件 / 全${items.length}件` : '未指定'}>
          <label className="field" style={{ marginTop: 10 }}>商品名・自治体・メモ
            <input type="text" placeholder="例: 牛　白糠　ティッシュ" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} /></label>
          <div className="row2">
            <label className="field">申請状況
              <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                <option value="">すべて</option>
                {APPLICATION_STATUSES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select></label>
            <label className="field">商品受取
              <select value={filter.receipt} onChange={(e) => setFilter({ ...filter, receipt: e.target.value as ItemFilter['receipt'] })}>
                <option value="">すべて</option>
                <option value="未">未</option>
                <option value="済">済</option>
              </select></label>
          </div>
          <div className="row2">
            <label className="field">対象年
              <select value={filter.year} onChange={(e) => setFilter({ ...filter, year: e.target.value })}>
                <option value="">すべて</option>
                <option value="candidate">候補（年なし）</option>
                {allYears.map((y) => <option key={y} value={String(y)}>{y}年</option>)}
              </select></label>
            <label className="field">寄付金額（下限〜上限）
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="text" inputMode="numeric" placeholder="下限" value={filter.minPrice ?? ''}
                  onChange={(e) => setFilter({ ...filter, minPrice: num(e.target.value) })} />
                <input type="text" inputMode="numeric" placeholder="上限" value={filter.maxPrice ?? ''}
                  onChange={(e) => setFilter({ ...filter, maxPrice: num(e.target.value) })} />
              </div></label>
          </div>
          <button className="btn small secondary" disabled={!searching} onClick={() => setFilter(EMPTY_FILTER)}>条件をクリア</button>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            条件を入れると、<b>年をまたいで {person} さんの全件</b>から探します（下の2つのリストの代わりに検索結果を表示）。
          </p>
        </Collapsible>
      </div>

      {searching ? (
        <div className="card">
          <h2>検索結果（{found.length}件 / 全{items.length}件）</h2>
          <ItemList list={found} showYear />
        </div>
      ) : (
        <>
          <div className="card">
            <h2>{year}年の寄付（{yearItems.length}件）</h2>
            <ItemList list={yearItems} />
          </div>

          <div className="card">
            <h2>
              候補の選び方（自動提案）
              <HelpTip title="候補選定について">
                候補・未購入の中から、<b>予算内で点数の合計がいちばん大きくなる組合せ</b>を選びます。
                <br />予算 = 採用上限 − 購入済み合計 − 安全マージン。<b>合計が予算を超えることはありません</b>。
                <br />点数の付け方はモードで変わります（下に表示）。優先度は各返礼品の編集画面で1〜5で設定します。
                <br />還元率が未入力の返礼品は、標準還元率（設定タブの「計算の基準値」で変更可）で計算します。
              </HelpTip>
            </h2>
            <div className="seg" style={{ flexWrap: 'wrap' }}>
              {PICK_MODES.map((m) => (
                <button key={m.value} className={pickMode === m.value ? 'on' : ''} onClick={() => setPickMode(m.value)}>{m.label}</button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
              {PICK_MODES.find((m) => m.value === pickMode)?.note}
            </p>
            <label className="field">安全マージン（円・上限からこの額を残す）
              <input type="text" inputMode="numeric" value={marginText} onChange={(e) => setMarginText(e.target.value)} /></label>

            {budget === null ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                上限額が未設定のため予算を出せません。上のカードで年収を入れるか、上限を手動指定してください。
              </p>
            ) : (
              <>
                <div className="kv" style={{ fontSize: 13 }}>
                  <span className="muted">予算（上限 {yen(limitAdopted ?? 0)} − 購入済み {yen(purchasedTotal)} − マージン {yen(margin)}）</span>
                  <span className={budget < 0 ? 'neg' : 'pos'}>{yen(budget)}</span>
                </div>
                {pick && pick.chosen.length > 0 ? (
                  <>
                    <div className="kv" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                      <span>この{pick.chosen.length}件がおすすめ</span>
                      <span className="big" style={{ fontSize: 18 }}>{yen(pick.total)}</span>
                    </div>
                    <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                      予算の {Math.round((pick.total / Math.max(1, budget)) * 100)}% を使用・残り {yen(budget - pick.total)}
                      {averageRate(pick.chosen) !== null && `／平均還元率 ${Math.round(averageRate(pick.chosen)! * 1000) / 10}%`}
                    </p>
                    <ItemList list={pick.chosen} showYear />
                    {pick.rest.length > 0 && (
                      <Collapsible title="今回は見送り" hint={`${pick.rest.length}件`}>
                        <ItemList list={pick.rest} showYear />
                      </Collapsible>
                    )}
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    {candidates.length === 0
                      ? '候補がまだありません。「＋ 寄付・候補を追加」から登録してください。'
                      : '予算内に収まる候補がありません（マージンを減らすか、安い候補を追加してください）。'}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="card">
            <h2>候補・未購入（{candidates.length}件）</h2>
            <ItemList list={candidates} showYear />
          </div>
        </>
      )}

      {modalOpen && (
        <FurusatoItemModal
          form={form}
          setForm={setForm}
          editing={editing}
          saving={saving}
          onSave={() => void saveItem()}
          onClose={() => setModalOpen(false)}
          onSearchMarket={searchMarket}
        />
      )}
    </>
  )
}
