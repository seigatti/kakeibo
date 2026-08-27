import { useMemo, useState } from 'react'
import HelpTip from '../components/HelpTip'
import { scenarioSummary, type LifeplanConfig } from '../lifeplan'
import {
  buildConfigFromAnswers,
  defaultAnswers,
  questionsFor,
  type SurveyAnswers,
  type SurveyMode,
} from '../lifeplanSurvey'

interface Props {
  /** 現在の設定。回答が触れない項目はこれを引き継ぐ */
  base: LifeplanConfig
  /** 生成した設定をシナリオとして保存 */
  onSave: (name: string, cfg: LifeplanConfig) => Promise<void> | void
  /** 生成した設定を現在の設定に反映 */
  onApply: (cfg: LifeplanConfig) => void
  saving?: boolean
}

/**
 * いくつかの選択式の質問に答えるだけでライフプランのシナリオを作るカード。
 * 生成結果は必ずプレビューしてから「保存」または「現在の設定に反映」を選ぶ。
 */
export default function ScenarioSurveyCard({ base, onSave, onApply, saving }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SurveyMode>('simple')
  const [answers, setAnswers] = useState<SurveyAnswers>(() => defaultAnswers('simple'))
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')

  const questions = useMemo(() => questionsFor(mode), [mode])
  const generated = useMemo(() => buildConfigFromAnswers(answers, base), [answers, base])

  const switchMode = (m: SurveyMode) => {
    setMode(m)
    // 詳細版で増えた質問にも既定値を入れる（共通の質問は回答を引き継ぐ）
    setAnswers((prev) => ({ ...defaultAnswers(m), ...prev }))
    setMsg('')
  }

  const save = async () => {
    const n = name.trim()
    if (!n) return
    await onSave(n, generated)
    setName('')
    setMsg(`シナリオ「${n}」を作成しました ✓ 比較のA/Bから選べます`)
  }

  const apply = () => {
    if (!window.confirm('アンケートの内容で現在の設定を置き換えます。よろしいですか？（保存前の変更は失われます）')) return
    onApply(generated)
    setMsg('現在の設定に反映しました（「設定を保存」で確定）')
  }

  return (
    <div className="card">
      <h2>
        アンケートからシナリオを作成
        <HelpTip title="アンケートについて">
          いくつかの質問に答えるだけで、ライフプランの設定一式（子供・学校・車・住まい・運用・インフレなど）を
          自動で組み立てます。
          <br />答えた項目だけが変わり、<b>大人の収入など今の設定は引き継ぎ</b>ます。
          <br />作成前に必ず内容をプレビューできます。「シナリオとして保存」なら今の設定は変わりません。
          <br />「税金が上がる」の回答は、手取りの伸び（昇給率）を鈍らせる形で反映しています。
        </HelpTip>
      </h2>

      {!open ? (
        <button className="btn secondary" onClick={() => setOpen(true)}>アンケートを開く</button>
      ) : (
        <>
          <div className="seg">
            <button className={mode === 'simple' ? 'on' : ''} onClick={() => switchMode('simple')}>簡易版（7問）</button>
            <button className={mode === 'detail' ? 'on' : ''} onClick={() => switchMode('detail')}>詳細版（12問）</button>
          </div>

          {questions.map((q, qi) => (
            <div key={q.id} style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, margin: '0 0 6px' }}>{qi + 1}. {q.question}</p>
              <div className="seg" style={{ flexWrap: 'wrap', marginBottom: 0 }}>
                {q.options.map((o) => (
                  <button
                    key={o.value}
                    style={{ flex: '1 0 30%' }}
                    className={answers[q.id] === o.value ? 'on' : ''}
                    onClick={() => { setAnswers((prev) => ({ ...prev, [q.id]: o.value })); setMsg('') }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {(() => {
                const note = q.options.find((o) => o.value === answers[q.id])?.note
                return note ? <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>→ {note}</p> : null
              })()}
            </div>
          ))}

          <h2 style={{ marginTop: 14 }}>できあがる設定（プレビュー）</h2>
          <div style={{ fontSize: 12, lineHeight: 1.8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            {scenarioSummary(generated).map((line, i) => (
              <div key={i} className="muted">{line}</div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'end', marginTop: 10 }}>
            <label className="field" style={{ marginBottom: 0, flex: 1 }}>この内容をシナリオとして保存
              <input type="text" placeholder="例: 子供2人・私立コース" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button className="btn small" style={{ width: 'auto', marginBottom: 2 }} disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? '保存中…' : '作成'}
            </button>
          </div>
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={apply}>現在の設定に反映する</button>
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => { setOpen(false); setMsg('') }}>閉じる</button>
          {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
        </>
      )}
    </div>
  )
}
