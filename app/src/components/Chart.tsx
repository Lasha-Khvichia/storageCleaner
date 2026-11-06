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
import { useMemo, type CSSProperties } from "react";
import { token } from "../lib/theme";
import { useStore } from "../store";

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

/**
 * Chart colours for the active theme, read from the `--sc-chart-*` tokens.
 * Re-computed when the theme changes, so charts restyle instantly.
 * (Names kept in CONSTANT_CASE so option-building code reads naturally.)
 */
export function useChartTheme() {
  const theme = useStore((s) => s.theme);
  return useMemo(() => {
    const SERIES_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => token(`--sc-chart-${i}`));
    return {
      theme,
      SERIES_COLORS,
      CHART_TEXT: token("--sc-chart-text"),
      CHART_LINE: token("--sc-chart-grid"),
      POSITIVE: token("--sc-positive-300"),
      ACCENT: token("--sc-accent-500"),
      BG: token("--sc-bg"),
      SURFACE: token("--sc-surface"),
      RAISED: token("--sc-surface-raised"),
      TEXT: token("--sc-text"),
      tooltipBase: {
        backgroundColor: token("--sc-tooltip-bg"),
        borderColor: "transparent",
        textStyle: { color: token("--sc-tooltip-text"), fontSize: 12, fontWeight: 500 },
        extraCssText: "border-radius: 12px; padding: 8px 12px; box-shadow: 0 12px 30px rgba(0,0,0,.45);",
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}

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
