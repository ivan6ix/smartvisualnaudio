// A bar chart's category label that wraps onto up to three lines to fit its own bar, so every bar keeps its name
// instead of the chart skipping labels that would overlap. Use with interval={0} on the XAxis.
import { wrapLabel } from "../../lib/chartLabels";

const CHAR_WIDTH = 6.2;
const LINE_HEIGHT = 13;
const MAX_LINES = 3;

export default function WrappedAxisTick({ x, y, payload, width, visibleTicksCount, fill, fontSize = 11 }) {
  const band = width && visibleTicksCount ? width / visibleTicksCount : 80;
  const maxChars = Math.max(4, Math.floor((band - 6) / CHAR_WIDTH));
  const lines = wrapLabel(payload?.value, maxChars, MAX_LINES);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{payload?.value}</title>
      <text textAnchor="middle" fill={fill} fontSize={fontSize}>
        {lines.map((line, index) => <tspan key={index} x={0} dy={index === 0 ? 12 : LINE_HEIGHT}>{line}</tspan>)}
      </text>
    </g>
  );
}

// Room under the chart for three lines of labels.
export const WRAPPED_AXIS_HEIGHT = 12 + LINE_HEIGHT * (MAX_LINES - 1) + 8;
