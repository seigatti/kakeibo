/**
 * 楽観更新（保存の応答を待たずに画面へ先に反映する）用の純関数。
 *
 * GAS 側の upsertRow_ / deleteRows_ と**同じ意味論**をクライアントでも再現する。
 * ほとんどのアクションは「キーで upsert」か「キーで delete」なので、
 * アクション→テーブル＋キーのレジストリ1枚でまかなえる。
 *
 * ここで表現しないアクション（複数シートに複雑に効くもの）は null を返し、
 * 呼び出し側は従来どおりサーバの応答を待つ。
 */
import type { AllData } from './types'

/** AllData のうち、行の配列になっているテーブル名 */
type TableName =
  | 'assets' | 'expenses' | 'fixed_costs' | 'income' | 'zaim_net'
  | 'furusato_items' | 'furusato_years' | 'furusato_salaries'
  | 'liabilities' | 'consumption' | 'memos' | 'settings'

type Row = Record<string, unknown>

interface UpsertSpec {
  kind: 'upsert'
  table: TableName
  /** 一致判定に使う列 */
  keys: string[]
  /** payload のどのプロパティに行が入っているか */
  from: 'row'
  /** GAS が id を採番するアクションは、クライアント側で先に振る */
  genId?: boolean
  /** GAS が updated_at を打つアクション */
  stampUpdatedAt?: boolean
}

interface UpsertManySpec {
  kind: 'upsertMany'
  table: TableName
  keys: string[]
  /** payload のどのプロパティに行の配列が入っているか */
  from: 'rows'
}

interface DeleteSpec {
  kind: 'delete'
  table: TableName
  /** payload のプロパティ名 → 行の列名（すべて一致した行を消す） */
  match: Record<string, string>
}

type Spec = UpsertSpec | UpsertManySpec | DeleteSpec

/** アクション→どのテーブルのどのキーを触るか（GAS の handleAction_ と対応） */
const SPECS: Record<string, Spec> = {
  upsertAsset: { kind: 'upsert', table: 'assets', keys: ['date'], from: 'row' },
  deleteAsset: { kind: 'delete', table: 'assets', match: { date: 'date' } },

  setIncome: { kind: 'upsert', table: 'income', keys: ['month'], from: 'row' },
  deleteIncome: { kind: 'delete', table: 'income', match: { month: 'month' } },

  setZaimNet: { kind: 'upsert', table: 'zaim_net', keys: ['month'], from: 'row' },
  setSetting: { kind: 'upsert', table: 'settings', keys: ['key'], from: 'row' },

  saveFixedCost: { kind: 'upsert', table: 'fixed_costs', keys: ['id'], from: 'row', genId: true },
  deleteFixedCost: { kind: 'delete', table: 'fixed_costs', match: { id: 'id' } },

  saveLiability: { kind: 'upsert', table: 'liabilities', keys: ['id'], from: 'row', genId: true },
  deleteLiability: { kind: 'delete', table: 'liabilities', match: { id: 'id' } },

  saveMemo: { kind: 'upsert', table: 'memos', keys: ['id'], from: 'row', genId: true, stampUpdatedAt: true },
  deleteMemo: { kind: 'delete', table: 'memos', match: { id: 'id' } },

  saveFurusatoItem: { kind: 'upsert', table: 'furusato_items', keys: ['id'], from: 'row', genId: true },
  deleteFurusatoItem: { kind: 'delete', table: 'furusato_items', match: { id: 'id' } },

  setFurusatoYear: { kind: 'upsert', table: 'furusato_years', keys: ['person', 'year'], from: 'row' },
  setFurusatoSalary: { kind: 'upsert', table: 'furusato_salaries', keys: ['person', 'year', 'month'], from: 'row' },
  setFurusatoSalaries: { kind: 'upsertMany', table: 'furusato_salaries', keys: ['person', 'year', 'month'], from: 'rows' },
  deleteFurusatoSalary: {
    kind: 'delete',
    table: 'furusato_salaries',
    match: { person: 'person', year: 'year', month: 'month' },
  },
}

/** シートの値は型がゆれる（数値/文字列）ので、キー比較は必ず文字列で行う（GAS の upsertRow_ と同じ） */
const sameKey = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

/** 空欄扱いの値か（GAS は amount/quantity が空なら削除する） */
const isBlank = (v: unknown) => v === null || v === undefined || v === ''

/** GAS の id 採番と同じ形式 */
function newId(): string {
  return String(Date.now())
}

/** 2桁ゼロ埋め */
const p2 = (n: number) => String(n).padStart(2, '0')

/** GAS の saveMemo と同じ 'yyyy-MM-dd HH:mm'（端末のローカル時刻） */
function nowStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/**
 * 送信する payload を確定させる。
 * GAS が採番していた id / updated_at をクライアント側で先に埋め、
 * ローカルとサーバで同じ値になるようにする（楽観更新のズレ防止）。
 */
export function withGeneratedId(action: string, payload: Record<string, unknown>): Record<string, unknown> {
  const spec = SPECS[action]
  if (!spec || spec.kind !== 'upsert' || (!spec.genId && !spec.stampUpdatedAt)) return payload
  const row = payload.row as Row | undefined
  if (!row) return payload
  const next: Row = { ...row }
  if (spec.genId && !next.id) next.id = newId()
  if (spec.stampUpdatedAt) next.updated_at = nowStamp()
  return { ...payload, row: next }
}

/** テーブルへ1行 upsert（キー一致なら置換、なければ末尾へ追加） */
function upsertInto(rows: Row[], row: Row, keys: string[]): Row[] {
  const i = rows.findIndex((r) => keys.every((k) => sameKey(r[k], row[k])))
  if (i < 0) return [...rows, row]
  const next = rows.slice()
  next[i] = row
  return next
}

/**
 * 楽観更新を当てた新しい AllData を返す。
 * 表現しないアクション（setMonthData / setMonthsData / renameFurusatoPerson / bulkImport など）は
 * null を返すので、呼び出し側はサーバの応答を待つこと。
 */
export function applyMutation(data: AllData, action: string, payload: Record<string, unknown>): AllData | null {
  // setExpense だけは「金額が空なら削除」という分岐がある（GAS の handleAction_ と同じ判定）
  if (action === 'setExpense') {
    const row = payload.row as Row | undefined
    if (!row) return null
    const rows = (data.expenses ?? []) as unknown as Row[]
    const next = isBlank(row.amount)
      ? rows.filter((r) => !(sameKey(r.month, row.month) && sameKey(r.category, row.category)))
      : upsertInto(rows, row, ['month', 'category'])
    return { ...data, expenses: next } as unknown as AllData
  }

  const spec = SPECS[action]
  if (!spec) return null
  const table = spec.table
  const rows = ((data as unknown as Record<string, Row[]>)[table] ?? []) as Row[]

  if (spec.kind === 'delete') {
    const next = rows.filter(
      (r) => !Object.entries(spec.match).every(([pk, col]) => sameKey(r[col], payload[pk])),
    )
    return { ...data, [table]: next } as AllData
  }

  if (spec.kind === 'upsertMany') {
    const list = payload[spec.from] as Row[] | undefined
    if (!Array.isArray(list)) return null
    let next = rows
    for (const row of list) next = upsertInto(next, row, spec.keys)
    return { ...data, [table]: next } as AllData
  }

  const row = payload[spec.from] as Row | undefined
  if (!row) return null
  return { ...data, [table]: upsertInto(rows, row, spec.keys) } as AllData
}

/** まだサーバに確定していない保存 */
export interface Pending {
  action: string
  payload: Record<string, unknown>
}

/**
 * サーバが確定した状態に、未確定の保存を順に積み直して画面用の状態を作る。
 *
 * 応答が返るたびに「確定状態＋まだ残っている未確定分」で作り直すことで、
 * 先に返ってきた応答が、後から積んだ楽観更新を消してしまうのを防ぐ。
 * applyMutation が null を返すアクション（setMonthData など）は素通しになる。
 */
export function replayPending(server: AllData, pending: Pending[]): AllData {
  let out = server
  for (const p of pending) out = applyMutation(out, p.action, p.payload) ?? out
  return out
}
