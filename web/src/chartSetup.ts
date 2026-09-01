import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  LineController,
  BarController,
  DoughnutController,
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
  ArcElement,
  LineController,
  BarController,
  DoughnutController,
  Tooltip,
  Legend,
  Filler,
)

import ChartDataLabels from 'chartjs-plugin-datalabels'
import { isMasked } from './utils'

// 値ラベル表示プラグイン。既定はOFFにして、使いたいチャートだけ options で有効化する
Chart.register(ChartDataLabels)
Chart.defaults.set('plugins.datalabels', { display: false })

// 凡例は既定だと箱・余白が大きくグラフ枠の高さを食うので、全体的に小さくする
Chart.defaults.plugins.legend.labels.boxWidth = 10
Chart.defaults.plugins.legend.labels.boxHeight = 10
Chart.defaults.plugins.legend.labels.padding = 8
Chart.defaults.plugins.legend.labels.font = { size: 11 }

Chart.defaults.color = '#94a3b8'
Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.15)'
Chart.defaults.font.family =
  "'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', system-ui, sans-serif"

// 金額マスク: ツールチップの数値もマスクする（グラフの形は残し、絶対額だけ隠す）
Chart.defaults.plugins.tooltip.callbacks = {
  ...Chart.defaults.plugins.tooltip.callbacks,
  label: (ctx) => {
    // 系列名。ドーナツはデータセットに label が無いので、セグメント名（ctx.label）を使う
    const name = ctx.dataset.label ?? ctx.label ?? ''
    if (isMasked()) return `${name}: ＊＊＊`
    const raw = ctx.parsed as unknown
    let v: number
    if (typeof raw === 'object' && raw !== null) {
      // parsed は軸名でキーされる（値=vScale側・カテゴリのindex=iScale側）。
      // 縦棒/折れ線は値がy、横棒(indexAxis:'y')は値がx なので、値スケールの軸を見て取り出す。
      const vAxis = ctx.chart.getDatasetMeta(ctx.datasetIndex)?.vScale?.axis === 'x' ? 'x' : 'y'
      v = (raw as Record<string, number>)[vAxis]
    } else {
      v = raw as number
    }
    return `${name}: ${Number(v).toLocaleString('ja-JP')}円`
  },
}
