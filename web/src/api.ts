import type { AllData } from './types'

export interface ApiConfig {
  url: string
  token: string
}

export function loadConfig(): ApiConfig | null {
  const url = localStorage.getItem('kakeibo.apiUrl')
  const token = localStorage.getItem('kakeibo.apiToken')
  return url && token ? { url, token } : null
}

export function saveConfig(cfg: ApiConfig) {
  localStorage.setItem('kakeibo.apiUrl', cfg.url.trim())
  localStorage.setItem('kakeibo.apiToken', cfg.token.trim())
}

interface ApiResponse {
  ok: boolean
  data?: AllData | Partial<AllData>
  /** 書き込み系で「変更したシートだけ」返ってきたことを示す（新しいGASのみ付く） */
  partial?: boolean
  error?: string
}

/**
 * 書き込みの応答。
 * partial のときは data に含まれるテーブルだけを差し替える（それ以外は手元の状態が正）。
 * 旧GAS（partial 無し）は全データが来るので、そのまま丸ごと差し替える。
 */
export interface MutationResult {
  data: Partial<AllData>
  partial: boolean
}

async function parse(res: Response): Promise<{ data: Partial<AllData>; partial: boolean }> {
  const body: ApiResponse = await res.json()
  if (!body.ok || !body.data) throw new Error(body.error ?? 'APIエラー')
  return { data: body.data, partial: body.partial === true }
}

/**
 * 全データ取得。
 * @param fresh true ならGAS側の短時間キャッシュを素通しして必ず最新を読む（↻ボタン用）
 */
export async function fetchAll(cfg: ApiConfig, fresh = false): Promise<AllData> {
  const url = `${cfg.url}?token=${encodeURIComponent(cfg.token)}${fresh ? '&fresh=1' : ''}`
  const res = await fetch(url)
  return (await parse(res)).data as AllData
}

/** 変更系。GASはpreflight(OPTIONS)を処理できないため text/plain で送る */
export async function postAction(
  cfg: ApiConfig,
  action: string,
  payload: Record<string, unknown>,
): Promise<MutationResult> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: cfg.token, action, ...payload }),
  })
  return parse(res)
}
