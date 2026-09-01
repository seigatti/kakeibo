import { useEffect, useState, type ReactNode } from 'react'
import HelpTip from '../components/HelpTip'
import {
  BASIC_PENSION_FULL,
  annualLoanPayment,
  childAllowanceByIndex,
  childAnnualCost,
  type LifeplanAdult,
  type LifeplanChild,
  type LifeplanConfig,
} from '../lifeplan'
import { applyStandardExpenses } from '../lifeplanSurvey'
import { amt, yen } from '../utils'

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


export interface EditorProps {
  cfg: LifeplanConfig
  upd: (patch: Partial<LifeplanConfig>) => void
  updAdult: (i: number, patch: Partial<LifeplanAdult>) => void
  updChild: (i: number, patch: Partial<LifeplanChild>) => void
  /** 給与データからの年収想定（手取り・額面） */
  estimatedIncome: Record<string, { net: number; gross: number } | null>
  /** 年金の想定額 */
  pensionEstOf: (a: LifeplanAdult) => number
  /** 実支出からの基本生活費の推定 */
  livingEstimate: { annual: number; months: number } | null
  persons: string[]
  /** 最新スナップショットの資産合計（負債差引後。開始資産のプレースホルダ用） */
  latestAssets: number | null
  /** 開始資産の内訳の説明（負債を引いていることを示す。無ければ出さない） */
  liabilityNote?: string | null
  /** 編集対象のシナリオ名。新規作成なら null */
  originalName: string | null
  saving?: boolean
  /** name を渡すとその名前で保存（新規 or 別名）。null なら originalName を上書き */
  onSave: (name: string | null) => void
  onCancel: () => void
}

/**
 * ライフプランの入力画面。閲覧用のグラフ・表は出さず、設定フォームだけを並べる。
 * （プラン画面は普段グラフ・表のみを表示し、修正・新規作成のときだけこの画面に入る）
 */
export default function LifeplanEditor({
  cfg, upd, updAdult, updChild, estimatedIncome, pensionEstOf, livingEstimate, persons, latestAssets, liabilityNote, originalName, saving, onSave, onCancel,
}: EditorProps) {
  const [saveAs, setSaveAs] = useState('')
  return (
    <>
      <div className="card">
        <h2>{originalName ? `シナリオを編集: ${originalName}` : '新しいシナリオを作成'}</h2>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          変更は保存を押すまで反映されません。「キャンセル」で編集前の内容に戻ります。
        </p>
      </div>

      <div className="card">
        <h2>基本設定</h2>
        <div className="row2">
          <DecimalField label="実質インフレ率（%/年）" value={cfg.inflation} onChange={(v) => upd({ inflation: v })}
            help={<HelpTip title="インフレ率">支出（基本生活費・子供費用・カスタム支出）が毎年この率で増えます。例: 2%なら10年後の生活費は約1.22倍。「実質資産」の換算（名目資産÷(1+率)^経過年）にも使われます。小数入力可（例: 1.5）。</HelpTip>} />
          <DecimalField label="運用利回り（%/年）" value={cfg.invest_return} onChange={(v) => upd({ invest_return: v })}
            help={<HelpTip title="運用利回り">投資分に毎年この率で複利が効きます。現金・年金には効きません。下の「収入のうち投資へ回す割合」を0にすると、毎年の黒字は現金のまま積み上がります。0にすると収支の積み上げだけの推移になります。</HelpTip>} />
        </div>
        <div className="row2">
          <DecimalField label="収入のうち投資へ回す割合（%）" value={cfg.invest_ratio ?? 0} onChange={(v) => upd({ invest_ratio: v })}
            help={<HelpTip title="投資へ回す割合">毎年の収入（給与・年金など）のうち、この割合だけを現金から投資分へ振り替えます（積立のイメージ）。振り替えた分には運用利回りの複利が効きます。<br />手元の現金の範囲内でしか振り替えないので、資産の合計が増えたり減ったりすることはありません（配分が変わるだけ）。<br />0にすると従来どおり黒字は全額現金に積み上がります。</HelpTip>} />
          <div />
        </div>
        <div className="row2">
          <label className="field">投資の取り崩し方式
            <HelpTip title="投資の取り崩し">
              退職後などに投資を計画的に現金化する設定です。
              <br />・率: 毎年「その年の投資残高 × 率」を現金へ移します（4%なら いわゆる4%ルール）。残高が減れば取り崩し額も減ります。
              <br />・金額: 毎年その額を現金へ移します。現在の価格で入力し、物価上昇に合わせて増額されます。
              <br />取り崩しは投資から現金へ移すだけなので、その年の総資産は変わりません（減るのは将来の複利分です）。
            </HelpTip>
            <select value={cfg.withdraw_mode ?? 'none'} onChange={(e) => upd({ withdraw_mode: e.target.value as LifeplanConfig['withdraw_mode'] })}>
              <option value="none">取り崩さない</option>
              <option value="rate">率で指定（%/年）</option>
              <option value="amount">金額で指定（年額）</option>
            </select></label>
          {cfg.withdraw_mode === 'rate' ? (
            <DecimalField label="取り崩し率（%/年）" value={cfg.withdraw_value ?? 4} onChange={(v) => upd({ withdraw_value: v })} />
          ) : cfg.withdraw_mode === 'amount' ? (
            <label className="field">取り崩し額（年額・現在価格）
              <input type="text" inputMode="numeric" value={cfg.withdraw_value ?? 0}
                onChange={(e) => upd({ withdraw_value: Number(e.target.value.replace(/[,，]/g, '')) || 0 })} /></label>
          ) : (
            <div />
          )}
        </div>
        {cfg.withdraw_mode !== 'none' && (
          <div className="row2">
            <label className="field">取り崩し開始年
              <input type="text" inputMode="numeric" value={cfg.withdraw_start_year ?? thisYear}
                onChange={(e) => upd({ withdraw_start_year: Number(e.target.value) || thisYear })} /></label>
            <label className="field">取り崩しを止める現金比率（%）
              <HelpTip title="取り崩しを止める現金比率">
                その年の 現金 ÷（現金＋投資）がこの割合以上なら、その年の取り崩しを見送ります。
                <br />現金が十分あるうちは投資を売らない、という運用を表せます。
                <br />0 にすると毎年ルールどおりに取り崩します。
              </HelpTip>
              <input type="text" inputMode="numeric" placeholder="0＝止めない" value={cfg.withdraw_skip_cash_ratio ?? 0}
                onChange={(e) => upd({ withdraw_skip_cash_ratio: Number(e.target.value) || 0 })} /></label>
          </div>
        )}
        <div className="row2">
          <label className="field">現金が足りないとき
            <HelpTip title="現金が足りないとき">
              取り崩しルールに従っても現金が不足する年の扱いです。
              <br />「投資から補う」にすると、不足分（下限を入れた場合はその水準まで）を投資から現金化します。
              <br />「補わない」は投資に手を付けない前提で、現金がマイナス（＝借入）のまま推移します。
              <br />どちらも投資⇔現金の移動なので、その年の総資産は変わりません。
            </HelpTip>
            <select value={cfg.shortfall_cover === false ? 'none' : 'cover'} onChange={(e) => upd({ shortfall_cover: e.target.value === 'cover' })}>
              <option value="cover">投資から補う</option>
              <option value="none">補わない</option>
            </select></label>
          {cfg.shortfall_cover !== false ? (
            <label className="field">保ちたい現金の下限（現在価格）
              <input type="text" inputMode="numeric" placeholder="0＝不足分だけ補う" value={cfg.cash_floor ?? 0}
                onChange={(e) => upd({ cash_floor: Number(e.target.value.replace(/[,，]/g, '')) || 0 })} /></label>
          ) : (
            <div />
          )}
        </div>
        <div className="row2">
          <DecimalField label="昇給率（%/年）" value={cfg.raise_rate} onChange={(v) => upd({ raise_rate: v })}
            help={<HelpTip title="昇給率">給与収入（手取り）が退職まで毎年この率で増える想定です。例: 0.1と入力すると毎年0.1%ずつ増加。<br />インフレ率と比べると実質の増減が分かります（<b>実質賃金 = 昇給率 − インフレ率</b>）。昇給率をインフレ率と同じにすれば実質横ばい、下回れば手取りは実質的に目減りします。</HelpTip>} />
          <DecimalField label="年金の上昇率（%/年）" value={cfg.pension_growth} onChange={(v) => upd({ pension_growth: v })}
            help={<HelpTip title="年金の上昇率">年金は物価に連動して改定されますが、マクロ経済スライドにより物価上昇より少し低く抑えられます。<br />既定はインフレ2%−スライド0.9%＝<b>1.1%</b>。スライドの直近実績は年0.3〜0.4%程度ですが、調整が数十年続く前提を踏まえ長期の標準として保守的に0.9%を採っています（設定タブの「計算の基準値」で変更できます）。<br /><b>0%にすると受給額が生涯据え置き</b>という、かなり厳しい前提になります。</HelpTip>} />
        </div>
        <div className="row2">
          <label className="field">基本生活費（空欄=実績から自動）
            <HelpTip title="基本生活費">
              家賃・食費・光熱費など世帯の年間支出（子供にかかる分は除く。子供費用は下の子供設定から自動計算）。現在価格で入力し、毎年インフレ率分増えていきます。
              {'\n\n'}空欄にすると<b>過去12ヶ月の実支出から自動推定</b>します:
              {'\n'}(固定費＋変動費＋その他支出) の月平均 × 12 − 現在の子供費用（年額）
              {'\n'}※子供費用を差し引くのは、プラン側で子供費用を別途加算するため二重計上を防ぐためです。実支出の記録が少ない月があると精度が下がります。
            </HelpTip>
            <input type="text" inputMode="numeric"
              placeholder={livingEstimate ? `想定: ${amt(livingEstimate.annual)}（実績より）` : '実績データ不足'}
              value={cfg.living_cost ?? ''} onChange={(e) => upd({ living_cost: numOrNull(e.target.value) })} /></label>
          <DecimalField label="子供費用の倍率（標準=1.0）" value={cfg.child_multiplier} onChange={(v) => upd({ child_multiplier: v })}
            help={<HelpTip title="子供費用の倍率">内蔵の標準費用（子供カードの？参照）に掛ける係数。ご家庭の実感に合わせて 0.8〜1.2 程度で調整してください（児童手当は倍率をかけずにそのまま差し引きます）。</HelpTip>} />
        </div>
        <div className="row2">
          <DecimalField label="退職後の基本生活費の割合（%）" value={cfg.living_cost_retire_ratio ?? 100} onChange={(v) => upd({ living_cost_retire_ratio: v })}
            help={<HelpTip title="退職後の基本生活費">全員が退職し終えた年から、基本生活費をこの割合にします（子供費用・カスタム支出は別扱い）。<br />家計調査では高齢無職世帯の消費支出は現役期より小さく、目安は<b>70%程度</b>です。<br />100%のままだと退職後も現役と同額を使い続ける前提になり、結果が厳しめに出ます。</HelpTip>} />
          <div />
        </div>
        <label className="field">
          開始資産（空欄=最新の記録を採用）
          <HelpTip title="開始資産の決まり方">
            空欄のときは<b>最新の資産記録から負債残高を差し引いた額</b>（＝負債を考慮した総資産）を使います。
            負債残高は「資産」タブのローンの返済スケジュールから、その時点の残高を計算しています。
            <br />差し引くのは<b>現金・年金の側</b>で、投資分はそのまま残します（借金があっても運用しているお金は減らないため）。
            <br />ライフプランはローンの返済自体は扱っていないので、ここで一度だけ差し引く形にしています。
          </HelpTip>
          <input type="text" inputMode="numeric" placeholder={latestAssets !== null ? `自動: ${amt(latestAssets)}` : ''}
            value={cfg.start_assets_override ?? ''} onChange={(e) => upd({ start_assets_override: numOrNull(e.target.value) })} /></label>
        {liabilityNote && <p className="muted" style={{ fontSize: 11, margin: '-6px 0 10px' }}>{liabilityNote}</p>}
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
          <button className="btn secondary small" onClick={() => upd({ custom_flows: applyStandardExpenses(cfg, 'standard') })}>
            ＋ 一般的な支出をまとめて
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
        <h2>保存</h2>
        {originalName && (
          <button className="btn" style={{ marginBottom: 10 }} onClick={() => onSave(null)} disabled={saving}>
            {saving ? '保存中…' : `「${originalName}」に上書き保存`}
          </button>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
          <label className="field" style={{ marginBottom: 0, flex: 1 }}>{originalName ? '別名で保存（新しいシナリオになります）' : 'シナリオ名'}
            <input type="text" placeholder="例: 私立コース" value={saveAs} onChange={(e) => setSaveAs(e.target.value)} /></label>
          <button className="btn small" style={{ width: 'auto', marginBottom: 2 }} disabled={saving || !saveAs.trim()} onClick={() => onSave(saveAs.trim())}>
            {originalName ? '別名で保存' : '作成'}
          </button>
        </div>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={onCancel} disabled={saving}>キャンセル</button>
      </div>
    </>
  )
}
