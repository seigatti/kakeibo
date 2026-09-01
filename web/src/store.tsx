import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchAll, loadConfig, postAction, saveConfig, type ApiConfig } from './api'
import { applyMutation, withGeneratedId } from './mutations'
import type { AllData } from './types'

interface FailedMutation {
  action: string
  payload: Record<string, unknown>
}

interface Store {
  config: ApiConfig | null
  data: AllData | null
  loading: boolean
  error: string | null
  saving: boolean
  /** 直近で失敗した保存（再試行ボタン用）。成功したら null に戻る */
  lastFailed: FailedMutation | null
  setConfig: (cfg: ApiConfig) => void
  refresh: () => Promise<void>
  mutate: (action: string, payload: Record<string, unknown>) => Promise<void>
  /** lastFailed をもう一度送る */
  retry: () => Promise<void>
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<ApiConfig | null>(loadConfig())
  const [data, setData] = useState<AllData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFailed, setLastFailed] = useState<FailedMutation | null>(null)

  // 楽観更新の差分は「今の状態」から作る必要があるが、setState は非同期なので
  // 常に最新を指す ref を正とし、state はその写しとして更新する。
  const dataRef = useRef<AllData | null>(null)
  const setStore = useCallback((next: AllData | null) => {
    dataRef.current = next
    setData(next)
  }, [])

  // 送信は必ず1本ずつ直列に流す。裏で送るようになると連続保存が追い越し合い、
  // 古い応答で新しい内容が上書きされることがあるため。
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const inflight = useRef(0)

  const refresh = useCallback(async () => {
    const cfg = loadConfig()
    if (!cfg) return
    setLoading(true)
    setError(null)
    try {
      setStore(await fetchAll(cfg))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [setStore])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setConfig = useCallback(
    (cfg: ApiConfig) => {
      saveConfig(cfg)
      setConfigState(cfg)
      void refresh()
    },
    [refresh],
  )

  /**
   * 保存。楽観更新できるアクションは**先に画面へ反映してから**裏で送る。
   * 失敗したら送信前の状態へ巻き戻し、再試行できるようにする。
   */
  const mutate = useCallback(
    async (action: string, rawPayload: Record<string, unknown>) => {
      const cfg = loadConfig()
      if (!cfg) throw new Error('設定画面でAPI URLとトークンを入力してください')

      // GASが採番していた id / updated_at は先にこちらで確定させる（ローカルとサーバでズレないように）
      const payload = withGeneratedId(action, rawPayload)

      // 送信前の状態を控えてから、先に画面へ反映する
      const rollback = dataRef.current
      if (rollback) {
        const next = applyMutation(rollback, action, payload)
        if (next) setStore(next)
      }

      setError(null)
      setSaving(true)
      inflight.current += 1

      const task = queue.current.then(async () => {
        try {
          const res = await postAction(cfg, action, payload)
          // サーバの返した内容が正。partial なら該当テーブルだけ差し替える
          if (res.partial) {
            const base = dataRef.current
            if (base) setStore({ ...base, ...res.data } as AllData)
          } else {
            setStore(res.data as AllData)
          }
          setLastFailed(null)
        } catch (e) {
          if (rollback) setStore(rollback) // 画面を送信前へ戻す
          setError(e instanceof Error ? e.message : String(e))
          setLastFailed({ action, payload })
          throw e
        } finally {
          inflight.current -= 1
          if (inflight.current === 0) setSaving(false)
        }
      })
      // 1件失敗しても後続を止めない（キューは常に解決済みのもので繋ぐ）
      queue.current = task.catch(() => undefined)
      return task
    },
    [setStore],
  )

  const retry = useCallback(async () => {
    if (!lastFailed) return
    const { action, payload } = lastFailed
    setLastFailed(null)
    await mutate(action, payload)
  }, [lastFailed, mutate])

  const value = useMemo(
    () => ({ config, data, loading, error, saving, lastFailed, setConfig, refresh, mutate, retry }),
    [config, data, loading, error, saving, lastFailed, setConfig, refresh, mutate, retry],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('StoreProvider missing')
  return s
}
