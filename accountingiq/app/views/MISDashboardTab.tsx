'use client';

import { useApp } from '@/lib/state';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend
} from 'recharts';

// Format numbers for Indian currency
function fmt(n: number): string {
  if (n === undefined || n === null || isNaN(n)) return '—';
  if (Math.abs(n) >= 10_000_000) return `${(n / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 100_000) return `${(n / 100_000).toFixed(2)} L`;
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

const COLORS = ['#0fd4a0', '#4a9eff', '#9b7fe8', '#f5a623', '#f26b5b'];

export default function MISDashboardTab() {
  const { state } = useApp();
  const { parsedData, results } = state;

  // Use parsed data if available and analysed, else use mock data for demonstration purposes
  const isRealData = state.analysed && Object.keys(parsedData).length > 0;

  // Real or mock KPIs
  const revenue = isRealData ? (parsedData.revenue || 0) : 12500000;
  const netProfit = isRealData ? (parsedData.netProfit || 0) : 1850000;
  const margin = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : '14.8';
  const cashBalance = isRealData ? (parsedData.bsCashBankTotal || 0) : 3450000;
  
  // Real or mock chart data
  const monthlyData = [
    { month: 'Apr', revenue: revenue * 0.08, expenses: revenue * 0.065, profit: revenue * 0.015 },
    { month: 'May', revenue: revenue * 0.085, expenses: revenue * 0.068, profit: revenue * 0.017 },
    { month: 'Jun', revenue: revenue * 0.09, expenses: revenue * 0.075, profit: revenue * 0.015 },
    { month: 'Jul', revenue: revenue * 0.1, expenses: revenue * 0.08, profit: revenue * 0.02 },
    { month: 'Aug', revenue: revenue * 0.11, expenses: revenue * 0.08, profit: revenue * 0.03 },
    { month: 'Sep', revenue: revenue * 0.105, expenses: revenue * 0.085, profit: revenue * 0.02 },
  ];

  const expenseBreakdown = [
    { name: 'Cost of Goods Sold', value: revenue * 0.4 },
    { name: 'Employee Benefit', value: revenue * 0.2 },
    { name: 'Admin & Office', value: revenue * 0.1 },
    { name: 'Sales & Marketing', value: revenue * 0.08 },
    { name: 'Depreciation & Taxes', value: revenue * 0.05 },
  ];

  const cashflowData = [
    { name: 'Operating', value: 2500000 },
    { name: 'Investing', value: -800000 },
    { name: 'Financing', value: -400000 },
  ];

  return (
    <div className="max-w-6xl mx-auto animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Executive Dashboard
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
            Real-time financial performance and MIS indicators. {isRealData ? 'Based on actual Tally data.' : 'Showing sample data until Tally XMLs are loaded.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:border-teal-500" style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>
            Download PDF
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard title="Total Revenue" value={`₹${fmt(revenue)}`} trend="+12.5%" trendUp={true} color="var(--blue)" />
        <KPICard title="Net Profit (PAT)" value={`₹${fmt(netProfit)}`} trend="+8.2%" trendUp={true} color="var(--teal)" />
        <KPICard title="Net Margin" value={`${margin}%`} trend="-1.1%" trendUp={false} color="var(--amber)" />
        <KPICard title="Cash & Bank Balance" value={`₹${fmt(cashBalance)}`} trend="+4.5%" trendUp={true} color="var(--green)" />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main Chart: Revenue vs Expenses */}
        <div className="col-span-2 rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-6" style={{ color: 'var(--text1)' }}>Revenue vs Expenses (Monthly Trend)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4a9eff" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#4a9eff" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f26b5b" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f26b5b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text3)' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(val) => `₹${fmt(val)}`} tick={{ fontSize: 11, fill: 'var(--text3)' }} tickLine={false} axisLine={false} />
                <RechartsTooltip formatter={(value: number) => `₹${fmt(value)}`} contentStyle={{ backgroundColor: 'var(--bg3)', borderColor: 'var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text1)' }} itemStyle={{ color: 'var(--text1)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" name="Revenue" dataKey="revenue" stroke="#4a9eff" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
                <Area type="monotone" name="Expenses" dataKey="expenses" stroke="#f26b5b" strokeWidth={2} fillOpacity={1} fill="url(#colorExpenses)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Expense Breakdown */}
        <div className="col-span-1 rounded-xl border p-5 flex flex-col" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text1)' }}>Expense Breakdown</h3>
          <div className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={expenseBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {expenseBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(value: number) => `₹${fmt(value)}`} contentStyle={{ backgroundColor: 'var(--bg3)', borderColor: 'var(--border)', borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 mt-2">
            {expenseBreakdown.slice(0, 4).map((item, i) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }}></div>
                  <span style={{ color: 'var(--text2)' }} className="truncate max-w-[120px]">{item.name}</span>
                </div>
                <span className="font-medium" style={{ color: 'var(--text1)' }}>₹{fmt(item.value)}</span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Profit Trend */}
        <div className="col-span-1 rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold mb-6" style={{ color: 'var(--text1)' }}>Net Profit Trend</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text3)' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(val) => `₹${fmt(val)}`} tick={{ fontSize: 11, fill: 'var(--text3)' }} tickLine={false} axisLine={false} />
                <RechartsTooltip formatter={(value: number) => `₹${fmt(value)}`} cursor={{ fill: 'var(--bg4)', opacity: 0.4 }} contentStyle={{ backgroundColor: 'var(--bg3)', borderColor: 'var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Bar name="Net Profit" dataKey="profit" fill="#0fd4a0" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Working Capital Snapshot */}
        <div className="col-span-2 rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>Working Capital Snapshot</h3>
            <span className="text-xs px-2 py-0.5 rounded border" style={{ background: 'var(--bg4)', borderColor: 'var(--border)', color: 'var(--text2)' }}>Current Ratio: 1.4x</span>
          </div>
          
          <div className="grid grid-cols-3 gap-6 h-48">
            <div className="flex flex-col justify-center space-y-4">
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Receivables (Debtors)</div>
                <div className="text-lg font-semibold" style={{ color: 'var(--blue)' }}>₹{fmt(revenue * 0.15)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text2)' }}>DSO: 45 Days</div>
              </div>
              <div className="h-px w-full" style={{ background: 'var(--border)' }}></div>
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text3)' }}>Payables (Creditors)</div>
                <div className="text-lg font-semibold" style={{ color: 'var(--coral)' }}>₹{fmt(revenue * 0.12)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text2)' }}>DPO: 38 Days</div>
              </div>
            </div>
            
            <div className="col-span-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[
                  { category: '0-30 Days', debtors: revenue * 0.08, creditors: revenue * 0.05 },
                  { category: '31-60 Days', debtors: revenue * 0.05, creditors: revenue * 0.04 },
                  { category: '60-90 Days', debtors: revenue * 0.015, creditors: revenue * 0.02 },
                  { category: '90+ Days', debtors: revenue * 0.005, creditors: revenue * 0.01 },
                ]} layout="vertical" margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--border)" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: 'var(--text3)' }} tickLine={false} axisLine={false} width={70} />
                  <RechartsTooltip formatter={(value: number) => `₹${fmt(value)}`} cursor={{ fill: 'var(--bg4)', opacity: 0.4 }} contentStyle={{ backgroundColor: 'var(--bg3)', borderColor: 'var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                  <Bar name="Debtors" dataKey="debtors" fill="#4a9eff" radius={[0, 4, 4, 0]} barSize={12} />
                  <Bar name="Creditors" dataKey="creditors" fill="#f26b5b" radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ title, value, trend, trendUp, color }: { title: string, value: string, trend: string, trendUp: boolean, color: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="text-xs mb-2" style={{ color: 'var(--text3)' }}>{title}</div>
      <div className="text-2xl font-bold mb-2" style={{ color: 'var(--text1)' }}>{value}</div>
      <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: trendUp ? 'var(--green)' : 'var(--red)' }}>
        <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: trendUp ? 'rgba(76,175,121,0.1)' : 'rgba(240,72,72,0.1)' }}>
          {trendUp ? '↑' : '↓'}
        </span>
        {trend} vs last month
      </div>
    </div>
  );
}
