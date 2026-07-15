import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { APPLICATION_METHODS, APPLICATION_STATUSES, DEFAULT_PERSONS, type FurusatoItem, type FurusatoPerson } from '../types'
import { amt, estimateSalary, furusatoLimitDetailed, parseBonusConfig, parseProfile, yen } from '../utils'
import HelpTip from '../components/HelpTip'
import ProfileCard from './ProfileCard'

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
  const [personState, setPersonState] = useState<FurusatoPerson>(localStorage.getItem('kakeibo.furusatoPerson') || '')
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [form, setForm] = useState(EMPTY_ITEM)
  const [editing, setEditing] = useState(false)
  const [yearForm, setYearForm] = useState({
    income: '', social_insurance: '', medical_deduction: '', limit_manual: '',
    life_paid: '', quake_paid: '', medical_paid: '',
  })
  const [msg, setMsg] = useState('')
  const [limitOpen, setLimitOpen] = useState(false)
  const [personEdit, setPersonEdit] = useState(false)
  const [newPerson, setNewPerson] = useState('')
  const [renames, setRenames] = useState<Record<string, string>>({})
  const appliedPrefill = useRef<string | null>(null)
  const itemFormRef = useRef<HTMLDivElement>(null)

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

  const personHasData = (p: string) =>
    (data?.furusato_items ?? []).some((i) => i.person === p) ||
    (data?.furusato_years ?? []).some((y) => y.person === p) ||
    (data?.furusato_salaries ?? []).some((s) => s.person === p)

  const savePersons = async (list: string[]) => {
    await mutate('setSetting', { row: { key: 'furusato_persons', value: list.join(',') } })
  }

  const addPerson = async () => {
    const name = newPerson.trim()
    if (!name || persons.includes(name)) return
    await savePersons([...persons, name])
    setNewPerson('')
    selectPerson(name)
  }

  const renamePerson = async (from: string) => {
    const to = (renames[from] ?? '').trim()
    if (!to || to === from || persons.includes(to)) return
    await mutate('renameFurusatoPerson', { from, to }) // 既存データを一括引き継ぎ
    await savePersons(persons.map((p) => (p === from ? to : p)))
    // 世帯主が旧名なら控除プロフィールも追随
    const raw = data?.settings.find((s) => s.key === 'furusato_profile')?.value
    if (raw) {
      const prof = parseProfile(raw)
      if (prof.head_person === from) {
        await mutate('setSetting', { row: { key: 'furusato_profile', value: JSON.stringify({ ...prof, head_person: to }) } })
      }
    }
    // ライフプランの大人の名前も追随（手取り年収の紐づけが切れないように）
    const lifeplanRaw = data?.settings.find((s) => s.key === 'lifeplan_config')?.value
    if (lifeplanRaw) {
      try {
        const plan = JSON.parse(lifeplanRaw) as { adults?: Array<{ name: string }> }
        if (plan.adults?.some((a) => a.name === from)) {
          plan.adults = plan.adults.map((a) => (a.name === from ? { ...a, name: to } : a))
          await mutate('setSetting', { row: { key: 'lifeplan_config', value: JSON.stringify(plan) } })
        }
      } catch {
        /* 壊れたJSONは触らない */
      }
    }
    setRenames({ ...renames, [from]: '' })
    if (person === from) selectPerson(to)
  }

  const deletePerson = async (p: string) => {
    if (personHasData(p)) {
      window.alert(`「${p}」には寄付や給与のデータがあるため削除できません。先にデータを削除するか、名前の変更で対応してください。`)
      return
    }
    if (!window.confirm(`管理者「${p}」を削除しますか？`)) return
    await savePersons(persons.filter((x) => x !== p))
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
    // 「寄付を編集」カードの位置へスクロール（最上部ではなく）
    itemFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
        {persons.map((p) => (
          <button key={p} className={person === p ? 'on' : ''} onClick={() => selectPerson(p)}>{p}</button>
        ))}
        <button title="管理者を編集" style={{ flex: '0 0 40px' }} className={personEdit ? 'on' : ''} onClick={() => setPersonEdit(!personEdit)}>✎</button>
        <select style={{ flex: 1, marginTop: 0, width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {allYears.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
      </div>

      {personEdit && (
        <div className="card">
          <h2>管理者の編集</h2>
          {persons.map((p) => (
            <div key={p} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ flex: '0 0 60px' }}>{p}</span>
              <input type="text" placeholder="新しい名前" style={{ marginTop: 0, flex: 1 }}
                value={renames[p] ?? ''} onChange={(e) => setRenames({ ...renames, [p]: e.target.value })} />
              <button className="btn small secondary" disabled={saving || !(renames[p] ?? '').trim()} onClick={() => void renamePerson(p)}>変更</button>
              <button className="btn danger small" disabled={saving} onClick={() => void deletePerson(p)}>削除</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="text" placeholder="追加する名前" style={{ marginTop: 0, flex: 1 }}
              value={newPerson} onChange={(e) => setNewPerson(e.target.value)} />
            <button className="btn small" style={{ width: 'auto' }} disabled={saving || !newPerson.trim()} onClick={() => void addPerson()}>追加</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            名前を変更すると、その管理者の寄付・上限・給与データもすべて新しい名前に引き継がれます。
          </p>
        </div>
      )}

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
        <details style={{ marginTop: 8 }} open={limitOpen} onToggle={(e) => setLimitOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="muted" style={{ fontSize: 13, cursor: 'pointer' }}>上限の計算・入力（年収・社会保険料など）</summary>
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
            <details style={{ marginBottom: 10 }}>
              <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>計算の内訳を表示</summary>
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
            </details>
          )}
          <button className="btn" onClick={() => void saveYear()} disabled={saving}>{saving ? '保存中…' : '上限情報を保存'}</button>
        </details>
      </div>

      <ProfileCard persons={persons} year={year} profile={profile} />

      <p className="muted" style={{ fontSize: 12, margin: '0 4px 12px' }}>
        💡 月次給与の入力カードは<b>収支タブ</b>へ移動しました（入力した給与はこのページの上限計算にも自動で使われます）
      </p>

      <div className="card" ref={itemFormRef}>
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
