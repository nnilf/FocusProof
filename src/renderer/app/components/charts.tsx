import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

const AXIS = { stroke: '#383940', tick: { fill: '#7b7c84', fontSize: 11 }, tickLine: false } as const;
const GRID = { stroke: '#26272c', vertical: false } as const;

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  format: (v: number) => string;
}

function ChartTooltip(props: TooltipContentProps<number, string> & { series: SeriesDef[]; labelFormat?: (l: string) => string }) {
  if (!props.active || !props.payload?.length) return null;
  const label = String(props.label ?? '');
  return (
    <div className="chart-tooltip">
      <div className="t-title">{props.labelFormat ? props.labelFormat(label) : label}</div>
      {props.series.map((s) => {
        const p = props.payload?.find((x) => x.dataKey === s.key);
        if (!p || typeof p.value !== 'number') return null;
        return (
          <div className="t-row" key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
            <b>{s.format(p.value)}</b>
          </div>
        );
      })}
    </div>
  );
}

export function Legend(props: { series: { label: string; color: string }[] }) {
  if (props.series.length < 2) return null;
  return (
    <div className="legend">
      {props.series.map((s) => (
        <span key={s.label}>
          <i style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

interface BaseChartProps {
  data: object[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  xFormat?: (v: string) => string;
  yFormat?: (v: number) => string;
  footer?: ReactNode;
}

function Frame(props: { height: number; series: SeriesDef[]; children: ReactNode; footer?: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Legend series={props.series} />
      <div style={{ width: '100%', height: props.height }}>
        <ResponsiveContainer>{props.children as React.ReactElement}</ResponsiveContainer>
      </div>
      {props.footer}
    </div>
  );
}

export function BarSeriesChart(props: BaseChartProps & { stacked?: boolean }) {
  const height = props.height ?? 220;
  return (
    <Frame height={height} series={props.series} footer={props.footer}>
      <BarChart data={props.data} barGap={2} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={props.xKey} {...AXIS} tickFormatter={props.xFormat} minTickGap={12} />
        <YAxis {...AXIS} axisLine={false} width={44} tickFormatter={props.yFormat} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={props.series} labelFormat={props.xFormat} />}
        />
        {props.series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={s.color}
            stackId={props.stacked ? 'stack' : undefined}
            radius={!props.stacked || i === props.series.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={28}
            stroke={props.stacked ? '#17181b' : undefined}
            strokeWidth={props.stacked ? 1 : 0}
          />
        ))}
      </BarChart>
    </Frame>
  );
}

export function LineSeriesChart(props: BaseChartProps & { area?: boolean; yDomain?: [number, number] }) {
  const height = props.height ?? 220;
  const tooltip = (
    <Tooltip
      cursor={{ stroke: '#5d5c58' }}
      content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={props.series} labelFormat={props.xFormat} />}
    />
  );
  if (props.area) {
    return (
      <Frame height={height} series={props.series} footer={props.footer}>
        <AreaChart data={props.data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey={props.xKey} {...AXIS} tickFormatter={props.xFormat} minTickGap={16} />
          <YAxis {...AXIS} axisLine={false} width={44} tickFormatter={props.yFormat} domain={props.yDomain} />
          {tooltip}
          {props.series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.12} dot={false} activeDot={{ r: 4 }} />
          ))}
        </AreaChart>
      </Frame>
    );
  }
  return (
    <Frame height={height} series={props.series} footer={props.footer}>
      <LineChart data={props.data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={props.xKey} {...AXIS} tickFormatter={props.xFormat} minTickGap={16} />
        <YAxis {...AXIS} axisLine={false} width={44} tickFormatter={props.yFormat} domain={props.yDomain} />
        {tooltip}
        {props.series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
        ))}
      </LineChart>
    </Frame>
  );
}

/** Horizontal labelled bars; used for "time by assignment" where labels are long. */
export function HorizontalBars(props: { items: { label: string; value: number; color: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...props.items.map((i) => i.value));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {props.items.map((item) => (
        <div key={item.label} style={{ display: 'grid', gap: 4 }} title={`${item.label}: ${props.format(item.value)}`}>
          <div className="spread small">
            <span className="truncate">{item.label}</span>
            <span className="num secondary">{props.format(item.value)}</span>
          </div>
          <div className="progress">
            <div style={{ width: `${(item.value / max) * 100}%`, background: item.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
