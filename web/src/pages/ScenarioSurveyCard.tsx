import { useMemo, useState } from 'react'
import HelpTip from '../components/HelpTip'
import { scenarioSummaryRows, type LifeplanConfig } from '../lifeplan'
import {
  answerEffects,
  buildConfigFromAnswers,
  defaultAnswers,
  expandPolicyAnswers,
  questionsFor,
  type SurveyAnswers,
  type SurveyMode,
} from '../lifeplanSurvey'

interface Props {
  /** 現在の設定。回答が触れない項目はこれを引き継ぐ */
  base: LifeplanConfig
  /** 生成した設定をシナリオとして保存 */
  onSave: (name: string, cfg: LifeplanConfig) => Promise<void> | void
  /** 生成した設定をそのまま編集画面へ渡す */
  onApply: (cfg: LifeplanConfig) => void
  /** 画面を閉じる */
  onCancel: () => void
  /** 実支出からの基本生活費の推定（「実績から自動」の実額表示に使う） */
  livingEstimate?: { annual: number; months: number } | null
  saving?: boolean
}

/**
 * いくつかの選択式の質問に答えるだけでライフプランのシナリオを作るカード。
 * 生成結果は必ずプレビューしてから「保存」または「現在の設定に反映」を選ぶ。
 */
export default function ScenarioSurveyCard({ base, onSave, onApply, onCancel, livingEstimate, saving }: Props) {
  const [mode, setMode] = useState<SurveyMode>('simple')
  const [answers, setAnswers] = useState<SurveyAnswers>(() => defaultAnswers('simple'))
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')

  const questions = useMemo(() => questionsFor(mode), [mode])
  const generated = useMemo(() => buildConfigFromAnswers(answers, base), [answers, base])
  const previewRows = useMemo(
    () => scenarioSummaryRows(generated, { livingEstimate: livingEstimate?.annual ?? null }),
    [generated, livingEstimate],
  )

  const switchMode = (m: SurveyMode) => {
    setMode(m)
    setAnswers((prev) => {
      if (m === 'detail') {
        // 簡易版で答えた「方針」から各詳細項目の初期値を作る
        return { ...defaultAnswers('detail'), ...expandPolicyAnswers(prev), ...prev }
      }
      // 簡易版へ戻すときは、詳細版で個別に答えた分を捨てて「方針」が効くようにする
      // （残したままだと方針を変えても詳細の回答が優先されて変わらないため）
      const keep = new Set(questionsFor('simple').map((q) => q.id))
      const kept: SurveyAnswers = {}
      for (const [k, v] of Object.entries(prev)) if (keep.has(k)) kept[k] = v
      return { ...defaultAnswers('simple'), ...kept }
    })
    setMsg('')
  }

  const save = async () => {
    const n = name.trim()
    if (!n) return
    await onSave(n, generated)
    setName('')
    setMsg(`シナリオ「${n}」を作成しました ✓`)
  }

  const apply = () => onApply(generated)

  return (
    <div className="card">
      <h2>
        アンケートからシナリオを作成
        <HelpTip title="アンケートについて">
          いくつかの質問に答えるだけで、ライフプランの設定一式（子供・学校・車・住まい・運用・インフレなど）を
          自動で組み立てます。
          <br />答えた項目だけが変わり、<b>大人の収入などの土台は引き継ぎ</b>ます。
          <br />作成前に必ず内容をプレビューできます。
          <br />簡易版は「方針」をいくつか選ぶだけで、詳細版の複数の項目がまとめて決まります
          （何が決まるかは各質問の下に「→」で表示されます）。詳細版に切り替えると、その内容を1つずつ調整できます。
          <br />「税金が上がる」の回答は、手取りの伸び（昇給率）を鈍らせる形で反映しています。
        </HelpTip>
      </h2>

      <>
          <div className="seg">
            <button className={mode === 'simple' ? 'on' : ''} onClick={() => switchMode('simple')}>簡易版（{questionsFor('simple').length}問）</button>
            <button className={mode === 'detail' ? 'on' : ''} onClick={() => switchMode('detail')}>詳細版（{questionsFor('detail').length}問）</button>
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
                const effects = answerEffects(q.id, answers[q.id], { livingEstimate })
                if (effects.length === 0) return null
                return (
                  <div className="muted" style={{ fontSize: 11, margin: '4px 0 0', lineHeight: 1.7 }}>
                    {effects.map((line, k) => (
                      <div key={k}>→ {line}</div>
                    ))}
                  </div>
                )
              })()}
            </div>
          ))}

          <h2 style={{ marginTop: 14 }}>できあがる設定（プレビュー）</h2>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px 10px' }}>
            {[...new Set(previewRows.map((r) => r.group))].map((g) => (
              <div key={g} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--accent)', borderBottom: '1px solid var(--border)', paddingBottom: 2, marginBottom: 4 }}>{g}</div>
                {previewRows.filter((r) => r.group === g).map((r, i) => (
                  <div className="kv" key={i} style={{ fontSize: 12, padding: '2px 0', gap: 12 }}>
                    <span className="muted" style={{ flex: '0 0 auto' }}>{r.label}</span>
                    <span style={{ textAlign: 'right' }}>{r.value}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'end', marginTop: 10 }}>
            <label className="field" style={{ marginBottom: 0, flex: 1 }}>シナリオ名を付けて作成
              <input type="text" placeholder="例: 子供2人・私立コース" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button className="btn small" style={{ width: 'auto', marginBottom: 2 }} disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? '保存中…' : '作成'}
            </button>
          </div>
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={apply}>この内容を編集画面で調整する</button>
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={onCancel}>キャンセル</button>
          {msg && <p className="pos center" style={{ margin: '8px 0 0' }}>{msg}</p>}
      </>
    </div>
  )
}
