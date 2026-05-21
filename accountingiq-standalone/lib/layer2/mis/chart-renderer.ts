/**
 * Chart.js → PNG buffer helper for embedding rendered charts inside the
 * Excel export.  Runs entirely in the browser via a hidden canvas; no
 * server round-trip needed.
 *
 * Resolution: every call uses 2× device pixel ratio so charts stay crisp
 * when Excel scales them in the worksheet.  Heights / widths passed in
 * are CSS pixels; the canvas backing store is twice as large.
 */

import {
  Chart, type ChartConfiguration, registerables,
} from 'chart.js';

// Chart.js requires explicit registration of components when using the
// scoped (non-`/auto`) entry point — register everything once at module
// load so individual charts don't need to do this themselves.
Chart.register(...registerables);

export interface RenderOptions {
  width?: number;
  height?: number;
  /** Backing-store scale factor.  2 = retina-quality. */
  scale?: number;
  /** Background to paint behind the chart (default transparent — Excel
   *  shows the worksheet fill, which is usually white). */
  background?: string;
}

/**
 * Render a Chart.js config to a PNG Uint8Array.  The chart is mounted on
 * an off-screen canvas, drawn synchronously, and the canvas immediately
 * converted to a buffer; nothing is left in the DOM after return.
 */
export async function renderChartToPNG(
  config: ChartConfiguration,
  opts: RenderOptions = {},
): Promise<Uint8Array> {
  const width = opts.width ?? 720;
  const height = opts.height ?? 320;
  const scale = opts.scale ?? 2;

  // Off-screen canvas at 2× resolution
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.position = 'fixed';
  canvas.style.left = '-99999px';
  canvas.style.top = '0';
  document.body.appendChild(canvas);

  // Disable animation so the first paint contains the final state.
  const cfg: ChartConfiguration = {
    ...config,
    options: {
      ...(config.options ?? {}),
      animation: false as unknown as ChartConfiguration['options'] extends infer T ? T extends { animation?: unknown } ? T['animation'] : never : never,
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: scale,
      plugins: {
        ...(config.options?.plugins ?? {}),
        legend: {
          ...(config.options?.plugins?.legend ?? {}),
          labels: {
            ...(config.options?.plugins?.legend?.labels ?? {}),
            font: { size: 11 * scale, ...(config.options?.plugins?.legend?.labels?.font ?? {}) },
          },
        },
      },
    },
  };

  // Paint background if requested.
  if (opts.background) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  const chart = new Chart(canvas, cfg);
  // Allow a microtask for the layout calc / first draw.
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  chart.draw();

  const dataUrl = canvas.toDataURL('image/png');
  chart.destroy();
  document.body.removeChild(canvas);

  return dataURLToUint8Array(dataUrl);
}

function dataURLToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}
