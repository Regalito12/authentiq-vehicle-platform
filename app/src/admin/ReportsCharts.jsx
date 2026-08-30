import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const chartColors = ["#c8a24b", "#5f6f6b", "#2f3b39", "#a33b2b", "#8d7a55"];

export default function ReportsCharts({ variant = "dashboard", byBrand = [], statusData = [], funnel = [] }) {
  if (variant === "funnel") {
    return <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={funnel} layout="vertical" margin={{ top: 8, right: 20, left: 18, bottom: 0 }}><XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={70} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [`${value}`, "Registros"]} /><Bar dataKey="value" radius={[0, 3, 3, 0]}>{funnel.map((item) => <Cell key={item.name} fill={item.fill} />)}</Bar></BarChart></ResponsiveContainer></div>;
  }

  return <div className="charts-grid">
    <article className="chart-panel"><div className="panel-heading"><div><span className="eyebrow">INVENTARIO</span><h3>Stock por marca</h3></div></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={byBrand} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}><XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [`${value} unidades`, "Stock"]} /><Bar dataKey="stock" fill="#c8a24b" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></article>
    <article className="chart-panel"><div className="panel-heading"><div><span className="eyebrow">ESTADO</span><h3>Distribución del inventario</h3></div></div><div className="chart-box status-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusData} dataKey="count" nameKey="label" innerRadius={52} outerRadius={78} paddingAngle={3}>{statusData.map((item, index) => <Cell key={item.status} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value, _name, item) => [`${value} vehículos`, item.payload.label]} /></PieChart></ResponsiveContainer><div className="chart-legend">{statusData.map((item, index) => <span key={item.status}><i style={{ background: chartColors[index % chartColors.length] }} />{item.label} · {item.count}</span>)}</div></div></article>
  </div>;
}
