'use client';

import { useId, useState } from 'react';
import { Card } from '@/components/ui/card';

const W = 320;
const H = 120;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const PAD_LEFT = 24;

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** A clean top for the y-axis: 1, 2, 5 or 10 times a power of ten, at least 1. */
function niceMax(max: number) {
  if (max <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/** Rounded top, square base: the bar's data end is the top. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * One series of daily counts as columns, with a hover tooltip and a screen-reader table.
 * Single series, so no legend: the title names it.
 */
export function DailyBarChart({
  title,
  dates,
  values,
}: {
  title: string;
  dates: string[];
  values: number[];
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const total = values.reduce((a, b) => a + b, 0);
  const top = niceMax(Math.max(0, ...values));
  const plotW = W - PAD_LEFT;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const slot = plotW / Math.max(1, values.length);
  const barW = Math.max(1, Math.min(24, slot - 2)); // 2px surface gap between bars
  const y = (v: number) => PAD_TOP + plotH - (v / top) * plotH;
  const h = hover != null ? { date: dates[hover]!, value: values[hover]! } : null;

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm text-muted-foreground" id={`${id}-title`}>
          {title}
        </h3>
        <p className="text-2xl font-semibold tabular-nums">{total.toLocaleString('en-AE')}</p>
      </div>
      <p className="h-4 text-xs text-muted-foreground" aria-live="polite">
        {h
          ? `${dayLabel(h.date)}: ${h.value.toLocaleString('en-AE')}`
          : `Last ${dates.length} days`}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full"
        role="img"
        aria-labelledby={`${id}-title`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive axis: baseline and the top tick. */}
        <line
          x1={PAD_LEFT}
          x2={W}
          y1={PAD_TOP + plotH}
          y2={PAD_TOP + plotH}
          className="stroke-border"
          strokeWidth={1}
        />
        <line
          x1={PAD_LEFT}
          x2={W}
          y1={PAD_TOP}
          y2={PAD_TOP}
          className="stroke-border"
          strokeWidth={1}
          opacity={0.6}
        />
        <text
          x={PAD_LEFT - 4}
          y={PAD_TOP + 3}
          textAnchor="end"
          className="fill-muted-foreground text-[9px]"
        >
          {top}
        </text>
        <text
          x={PAD_LEFT - 4}
          y={PAD_TOP + plotH + 3}
          textAnchor="end"
          className="fill-muted-foreground text-[9px]"
        >
          0
        </text>
        {dates.length > 0 ? (
          <>
            <text x={PAD_LEFT} y={H - 4} className="fill-muted-foreground text-[9px]">
              {dayLabel(dates[0]!)}
            </text>
            <text x={W} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[9px]">
              {dayLabel(dates.at(-1)!)}
            </text>
          </>
        ) : null}
        {values.map((v, i) => {
          const x = PAD_LEFT + i * slot + (slot - barW) / 2;
          return (
            <g key={dates[i]}>
              {v > 0 ? (
                <path
                  d={barPath(x, y(v), barW, PAD_TOP + plotH - y(v))}
                  className="fill-primary"
                  opacity={hover == null || hover === i ? 1 : 0.45}
                />
              ) : null}
              {/* Hit target: the whole column slot, taller than the mark. */}
              <rect
                x={PAD_LEFT + i * slot}
                y={PAD_TOP}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{title}, per day</caption>
        <tbody>
          {dates.map((d, i) => (
            <tr key={d}>
              <th scope="row">{d}</th>
              <td>{values[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
