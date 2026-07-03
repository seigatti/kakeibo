import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchAll, loadConfig, postAction, saveConfig, type ApiConfig } from './api'
import type { AllData } from './types'

interface Store {
  config: ApiConfig | null
  data: AllData | null
  loading: boolean
  error: string | null
  saving: boolean
  setConfig: (cfg: ApiConfig) => void
  refresh: () => Promise<void>
  mutate: (action: string, payload: Record<string, unknown>) => Promise<void>
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<ApiConfig | null>(loadConfig())
  const [data, setData] = useState<AllData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const cfg = loadConfig()
    if (!cfg) return
    setLoading(true)
    setError(null)
    try {
      setData(await fetchAll(cfg))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

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

  const mutate = useCallback(async (action: string, payload: Record<string, unknown>) => {
    const cfg = loadConfig()
    if (!cfg) throw new Error('設定画面でAPI URLとトークンを入力してください')
    setSaving(true)
    setError(null)
    try {
      setData(await postAction(cfg, action, payload))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setSaving(false)
    }
  }, [])

  const value = useMemo(
    () => ({ config, data, loading, error, saving, setConfig, refresh, mutate }),
    [config, data, loading, error, saving, setConfig, refresh, mutate],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('StoreProvider missing')
  return s
}
