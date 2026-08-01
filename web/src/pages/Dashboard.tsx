import { useStore } from '../store'
import HomeGraphs from './HomeGraphs'

export default function Dashboard() {
  const { data } = useStore()
  if (!data) return null
  return <HomeGraphs data={data} />
}
