import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  LineController,
  BarController,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  LineController,
  BarController,
  Tooltip,
  Legend,
  Filler,
)

import ChartDataLabels from 'chartjs-plugin-datalabels'
import { isMasked } from './utils'

// 値ラベル表示プラグイン。既定はOFFにして、使いたいチャートだけ options で有効化する
Chart.register(ChartDataLabels)
Chart.defaults.set('plugins.datalabels', { display: false })

Chart.defaults.color = '#94a3b8'
Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.15)'
Chart.defaults.font.family =
  "'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', system-ui, sans-serif"

// 金額マスク: ツールチップの数値もマスクする（グラフの形は残し、絶対額だけ隠す）
Chart.defaults.plugins.tooltip.callbacks = {
  ...Chart.defaults.plugins.tooltip.callbacks,
  label: (ctx) => {
    const name = ctx.dataset.label ?? ''
    if (isMasked()) return `${name}: ＊＊＊`
    const raw = ctx.parsed as unknown
    const v = typeof raw === 'object' && raw !== null ? (raw as { y: number }).y : (raw as number)
    return `${name}: ${Number(v).toLocaleString('ja-JP')}円`
  },
}
