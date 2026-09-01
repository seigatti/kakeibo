import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchAll, loadConfig, postAction, saveConfig, type ApiConfig } from './api'
import { replayPending, withGeneratedId, type Pending } from './mutations'
import type { AllData } from './types'

interface Store {
  config: ApiConfig | null
  data: AllData | null
  loading: boolean
  error: string | null
  saving: boolean
  /** 直近で失敗した保存（再試行ボタン用）。成功したら null に戻る */
  lastFailed: Pending | null
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
  const [lastFailed, setLastFailed] = useState<Pending | null>(null)

  // 画面 = 「サーバが確定した状態」に「まだ確定していない保存」を積み直したもの。
  // 応答が返るたびに作り直すので、先に返った応答が後から積んだ楽観更新を消すことがない。
  const serverRef = useRef<AllData | null>(null)
  const pendingRef = useRef<Pending[]>([])

  /** 確定状態＋未確定分から画面用の状態を作り直す */
  const recompute = useCallback(() => {
    const server = serverRef.current
    setData(server ? replayPending(server, pendingRef.current) : null)
    setSaving(pendingRef.current.length > 0)
  }, [])

  // 送信は必ず1本ずつ直列に流す（連続保存が追い越し合わないように）
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const refresh = useCallback(async () => {
    const cfg = loadConfig()
    if (!cfg) return
    setLoading(true)
    setError(null)
    try {
      serverRef.current = await fetchAll(cfg)
      recompute() // 未確定分は保持したまま作り直す
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [recompute])

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
   * 保存。未確定リストへ積んで即座に画面へ反映し、送信は裏で直列に行う。
   * 成否が決まったらその1件だけをリストから外して作り直す。
   */
  const mutate = useCallback(
    async (action: string, rawPayload: Record<string, unknown>) => {
      const cfg = loadConfig()
      if (!cfg) throw new Error('設定画面でAPI URLとトークンを入力してください')

      // GASが採番していた id / updated_at は先にこちらで確定させる（ローカルとサーバでズレないように）
      const payload = withGeneratedId(action, rawPayload)
      const entry: Pending = { action, payload }

      pendingRef.current = [...pendingRef.current, entry]
      recompute()
      setError(null)

      /** この1件を未確定リストから外す */
      const drop = () => {
        pendingRef.current = pendingRef.current.filter((p) => p !== entry)
      }

      const task = queue.current.then(async () => {
        try {
          const res = await postAction(cfg, action, payload)
          // サーバの返した内容を確定状態へ反映（partial なら該当テーブルだけ）
          const base = serverRef.current
          serverRef.current = res.partial && base ? ({ ...base, ...res.data } as AllData) : (res.data as AllData)
          drop()
          recompute() // 残りの未確定分は積み直されるので消えない
          setLastFailed(null)
        } catch (e) {
          drop()
          recompute() // 失敗した1件だけ取り消す（他の未確定分はそのまま）
          setError(e instanceof Error ? e.message : String(e))
          setLastFailed(entry)
          throw e
        }
      })
      // 1件失敗しても後続を止めない（キューは常に解決済みのもので繋ぐ）
      queue.current = task.catch(() => undefined)
      return task
    },
    [recompute],
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
