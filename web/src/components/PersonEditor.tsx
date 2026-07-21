import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { DEFAULT_PERSONS } from '../types'
import { parseProfile } from '../utils'

/**
 * 管理者（世帯メンバー）の追加・名前変更・削除。
 * 名前変更時は ふるさとデータ（items/years/salaries）・控除プロフィールの世帯主・
 * ライフプランの大人名まで一括で追随させる。設定ページに配置。
 */
export default function PersonEditor() {
  const { data, mutate, saving } = useStore()
  const [newPerson, setNewPerson] = useState('')
  const [renames, setRenames] = useState<Record<string, string>>({})

  const persons = useMemo(() => {
    const raw = data?.settings.find((s) => s.key === 'furusato_persons')?.value
    const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_PERSONS
    return list.length ? list : DEFAULT_PERSONS
  }, [data])

  const personHasData = (p: string) =>
    (data?.furusato_items ?? []).some((i) => i.person === p) ||
    (data?.furusato_years ?? []).some((y) => y.person === p) ||
    (data?.furusato_salaries ?? []).some((s) => s.person === p)

  const savePersons = (list: string[]) => mutate('setSetting', { row: { key: 'furusato_persons', value: list.join(',') } })

  const addPerson = async () => {
    const name = newPerson.trim()
    if (!name || persons.includes(name)) return
    await savePersons([...persons, name])
    setNewPerson('')
  }

  const renamePerson = async (from: string) => {
    const to = (renames[from] ?? '').trim()
    if (!to || to === from || persons.includes(to)) return
    await mutate('renameFurusatoPerson', { from, to })
    await savePersons(persons.map((p) => (p === from ? to : p)))
    const profRaw = data?.settings.find((s) => s.key === 'furusato_profile')?.value
    if (profRaw) {
      const prof = parseProfile(profRaw)
      if (prof.head_person === from) {
        await mutate('setSetting', { row: { key: 'furusato_profile', value: JSON.stringify({ ...prof, head_person: to }) } })
      }
    }
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
    if (localStorage.getItem('kakeibo.furusatoPerson') === from) localStorage.setItem('kakeibo.furusatoPerson', to)
  }

  const deletePerson = async (p: string) => {
    if (personHasData(p)) {
      window.alert(`「${p}」には寄付や給与のデータがあるため削除できません。先にデータを削除するか、名前の変更で対応してください。`)
      return
    }
    if (!window.confirm(`管理者「${p}」を削除しますか？`)) return
    await savePersons(persons.filter((x) => x !== p))
  }

  return (
    <div className="card">
      <h2>管理者（世帯メンバー）</h2>
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
        ふるさと納税・収支の給与・ライフプランで共通の世帯メンバーです。名前を変更すると、その人の寄付・上限・給与・プランのデータもすべて新しい名前に引き継がれます。
      </p>
    </div>
  )
}
