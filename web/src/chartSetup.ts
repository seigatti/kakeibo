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

Chart.defaults.color = '#94a3b8'
Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.15)'
Chart.defaults.font.family =
  "'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', system-ui, sans-serif"
