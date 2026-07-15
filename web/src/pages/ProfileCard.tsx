import { useEffect, useState } from 'react'
import HelpTip from '../components/HelpTip'
import { useStore } from '../store'
import type { FurusatoProfile } from '../types'
import { dependentDeduction, yen } from '../utils'

/** 世帯で1つの控除プロフィール（家族構成・住宅ローン）。頻繁に変わらないものをここに集約 */
export default function ProfileCard({ persons, year, profile }: { persons: string[]; year: number; profile: FurusatoProfile }) {
  const { mutate, saving } = useStore()
  const [head, setHead] = useState('')
  const [spouse, setSpouse] = useState(false)
  const [births, setBirths] = useState<string[]>([])
  const [loanEnabled, setLoanEnabled] = useState(false)
  const [loanAmount, setLoanAmount] = useState('')
  const [msg, setMsg] = useState('')

  // 保存済みプロフィールをフォームへ反映
  useEffect(() => {
    setHead(profile.head_person ?? '')
    setSpouse(profile.spouse)
    setBirths(profile.dependents.map((d) => String(d.birth_year)))
    setLoanEnabled(profile.housing_loan.enabled)
    setLoanAmount(profile.housing_loan.annual_deduction?.toString() ?? '')
  }, [profile])

  const save = async () => {
    setMsg('')
    const next: FurusatoProfile = {
      head_person: head || null,
      spouse,
      dependents: births
        .map((b) => Number(b.trim()))
        .filter((y) => y > 1900 && y < 2100)
        .map((birth_year) => ({ birth_year })),
      housing_loan: {
        enabled: loanEnabled,
        annual_deduction: loanAmount.trim() === '' ? null : Number(loanAmount.replace(/[,，]/g, '')),
      },
    }
    await mutate('setSetting', { row: { key: 'furusato_profile', value: JSON.stringify(next) } })
    setMsg('保存しました ✓')
  }

  const depInfo = (b: string) => {
    const by = Number(b.trim())
    if (!(by > 1900 && by < 2100)) return null
    const age = year - by
    const d = dependentDeduction(age)
    return `${year}年時点 ${age}歳・${d.label}${d.it > 0 ? `（${yen(d.it)}）` : ''}`
  }

  return (
    <div className="card">
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>
          控除プロフィール（世帯で1つ：家族構成・住宅ローン）
        </summary>
        <p className="muted" style={{ fontSize: 12 }}>
          頻繁に変わらない設定です。配偶者・扶養・住宅ローン控除は<b>世帯主の上限計算にのみ</b>反映されます。
          <HelpTip title="各控除の計算">
            扶養控除（対象年12/31時点の年齢で自動判定・所得税/住民税）:<br />
            16歳未満=対象外 / 16〜18歳=38万/33万 / 19〜22歳（特定）=63万/45万 / 23〜69歳=38万/33万 / 70歳〜（老人）=48万/38万。<br />
            配偶者控除=38万/33万。<br />
            住宅ローン控除: 年間控除額のうち所得税から引き切れない分が住民税から控除され（上限: 所得税課税所得×7%か136,500円）、その分ふるさとの上限が下がります。
          </HelpTip>
        </p>
        <label className="field">世帯主
          <select value={head} onChange={(e) => setHead(e.target.value)}>
            <option value="">（未設定）</option>
            {persons.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
        <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" style={{ width: 'auto', marginTop: 0 }} checked={spouse} onChange={(e) => setSpouse(e.target.checked)} />
          配偶者控除あり（38万/33万）
        </label>

        <p style={{ fontSize: 13, margin: '10px 0 4px' }}>扶養家族（生年を入力すると年齢・区分は自動判定）</p>
        {births.map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <input type="text" inputMode="numeric" placeholder="生年 例: 2015" style={{ marginTop: 0, flex: '0 0 110px' }}
              value={b} onChange={(e) => setBirths(births.map((x, j) => (j === i ? e.target.value : x)))} />
            <span className="muted" style={{ fontSize: 11, flex: 1 }}>{depInfo(b) ?? '西暦4桁で入力'}</span>
            <button className="btn danger small" onClick={() => setBirths(births.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn secondary small" style={{ marginBottom: 10 }} onClick={() => setBirths([...births, ''])}>＋ 扶養家族を追加</button>

        <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" style={{ width: 'auto', marginTop: 0 }} checked={loanEnabled} onChange={(e) => setLoanEnabled(e.target.checked)} />
          住宅ローン控除を適用中
        </label>
        {loanEnabled && (
          <label className="field">年間控除額（年末調整・確定申告で決まる額）
            <input type="text" inputMode="numeric" placeholder="例: 200000" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} /></label>
        )}
        <button className="btn" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : 'プロフィールを保存'}</button>
        {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
      </details>
    </div>
  )
}
