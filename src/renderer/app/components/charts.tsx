import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { useThemeColors } from '../lib/theme';

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

/**
 * Bars per category. With `overlay`, later series are drawn on top of earlier ones at the same
 * position (e.g. ALT over total session time) rather than side by side.
 */
export function BarSeriesChart(props: {
  data: object[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  overlay?: boolean;
  xFormat?: (v: string) => string;
  yFormat?: (v: number) => string;
}) {
  const c = useThemeColors();
  const axis = { stroke: c.rule, tick: { fill: c.ink3, fontSize: 12 }, tickLine: false } as const;
  const barSize = props.data.length > 40 ? 6 : props.data.length > 16 ? 12 : 22;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {props.series.length > 1 && <Legend series={props.series} />}
      <div style={{ width: '100%', height: props.height ?? 200 }}>
        <ResponsiveContainer>
          <BarChart data={props.data} barGap={props.overlay ? -barSize : 2} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.rule} vertical={false} />
            <XAxis dataKey={props.xKey} {...axis} tickFormatter={props.xFormat} minTickGap={16} />
            <YAxis {...axis} axisLine={false} width={40} tickFormatter={props.yFormat} />
            <Tooltip
              cursor={{ fill: c.tint }}
              content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={props.series} labelFormat={props.xFormat} />}
            />
            {props.series.map((s) => (
              <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[3, 3, 0, 0]} barSize={barSize} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
