"use client";

import { useId } from "react";
import { cn } from "@/lib/format";

export function Sparkline({
  points,
  height = 120,
  className,
  color,
  fill = true,
  showEndDot = true,
}: {
  points: { ts: number; value: number }[];
  height?: number;
  className?: string;
  color?: string;
  fill?: boolean;
  showEndDot?: boolean;
}) {
  const gid = useId().replace(/[:]/g, "");
  const width = 600;

  if (!points || points.length < 2) {
    return (
      <div
        className={cn("w-full rounded-lg bg-panel/40", className)}
        style={{ height }}
      />
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.01 || 1;
  const pad = span * 0.12;
  const lo = min - pad;
  const hi = max + pad;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  const rising = points[points.length - 1].value >= points[0].value;
  const stroke = color || (rising ? "#16c784" : "#ea3943");
  const endX = x(points.length - 1);
  const endY = y(points[points.length - 1].value);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={width}
          y1={height * f}
          y2={height * f}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {fill ? <path d={area} fill={`url(#g-${gid})`} /> : null}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {showEndDot ? (
        <circle
          cx={endX}
          cy={endY}
          r="4"
          fill={stroke}
          stroke="#0b0e11"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
