'use client'

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { formatPaiseCompact } from '@/lib/money'

export interface TrendPoint {
  label: string
  paise: number
  current: boolean
}

export default function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.every((d) => d.paise === 0)) {
    return (
      <p className="py-8 text-center text-sm text-ink-400">
        A couple of months of history and a trend will appear here.
      </p>
    )
  }

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: '#9b9797' }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(32,30,29,0.05)' }}
            formatter={(value: number) => [formatPaiseCompact(value), 'Household']}
            contentStyle={{
              borderRadius: 0,
              border: '1px solid #d7d3d3',
              fontSize: 13,
            }}
          />
          <Bar dataKey="paise" radius={0}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.current ? '#ec3013' : '#ffc4b8'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
