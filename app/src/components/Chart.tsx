// Tree-shaken ECharts setup shared by every chart in the app.
import ReactEChartsCoreModule from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, TreemapChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CSSProperties } from "react";

// echarts-for-react ships CommonJS: Vite dev hands us `{ default: Component }`
// while the production build unwraps it. Accept both.
const ReactEChartsCore = ((ReactEChartsCoreModule as unknown as { default?: typeof ReactEChartsCoreModule }).default ??
  ReactEChartsCoreModule) as typeof ReactEChartsCoreModule;

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  TreemapChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export const CHART_TEXT = "#8a94ab";
export const CHART_LINE = "#232c40";
export const SERIES_COLORS = ["#6d8bff", "#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#60a5fa"];

export const tooltipBase = {
  backgroundColor: "#0f1522",
  borderColor: "#2a3550",
  textStyle: { color: "#e6e9f2", fontSize: 12 },
  extraCssText: "border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.4);",
};

export function Chart({
  option,
  style,
  onEvents,
}: {
  // ECharts options are deeply dynamic; typed loosely on purpose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  option: any;
  style?: CSSProperties;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvents?: Record<string, (params: any) => void>;
}) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      lazyUpdate
      style={{ height: 300, width: "100%", ...style }}
      onEvents={onEvents}
      opts={{ renderer: "canvas" }}
    />
  );
}
