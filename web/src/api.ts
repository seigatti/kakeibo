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
  data?: AllData
  error?: string
}

async function parse(res: Response): Promise<AllData> {
  const body: ApiResponse = await res.json()
  if (!body.ok || !body.data) throw new Error(body.error ?? 'APIエラー')
  return body.data
}

export async function fetchAll(cfg: ApiConfig): Promise<AllData> {
  const res = await fetch(`${cfg.url}?token=${encodeURIComponent(cfg.token)}`)
  return parse(res)
}

/** 変更系。GASはpreflight(OPTIONS)を処理できないため text/plain で送る */
export async function postAction(cfg: ApiConfig, action: string, payload: Record<string, unknown>): Promise<AllData> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: cfg.token, action, ...payload }),
  })
  return parse(res)
}
