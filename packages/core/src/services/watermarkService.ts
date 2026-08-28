import type { GridCore } from "../core/gridCore";
import type { WatermarkConfig } from "../types/options";

type WatermarkContext = Pick<GridCore<any>, "isDestroyed" | "options" | "skeleton">;

export class WatermarkService {
  private overlay: HTMLElement | null = null;

  constructor(private core: WatermarkContext) {}

  init(): void {
    this.overlay = document.createElement("div");
    this.overlay.className = "mach-watermark";
    this.overlay.setAttribute("aria-hidden", "true");
    this.overlay.style.pointerEvents = "none";
    this.core.skeleton.root.appendChild(this.overlay);
    this.apply();
  }

  apply(): void {
    if (!this.overlay || this.core.isDestroyed()) return;
    const config = this.core.options.watermarkEnabled ? this.core.options.watermarkConfig : null;
    if (!config || !config.text) {
      this.overlay.style.display = "none";
      this.overlay.style.backgroundImage = "";
      return;
    }
    const url = this.buildTile(config);
    this.overlay.style.display = "";
    if (url) {
      this.overlay.style.backgroundImage = `url(${url})`;
      this.overlay.style.backgroundColor = "";
    } else {
      this.overlay.style.backgroundImage = "";
    }
  }

  private buildTile(config: WatermarkConfig): string | null {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const fontSize = config.fontSize ?? 14;
      const gap = config.gap ?? 160;
      const angle = config.angle ?? -22;
      const color = config.color ?? (this.isDark() ? "rgba(255,255,255,0.9)" : "rgba(31,55,88,0.9)");
      const opacity = config.opacity ?? 0.06;

      ctx.font = `500 ${fontSize}px sans-serif`;
      const metrics = ctx.measureText(config.text);
      const textW = Math.ceil(metrics.width);

      const tile = Math.max(gap, textW + 40);
      canvas.width = tile;
      canvas.height = tile;

      const ctx2 = canvas.getContext("2d")!;
      ctx2.clearRect(0, 0, tile, tile);
      ctx2.globalAlpha = opacity;
      ctx2.fillStyle = color;
      ctx2.font = `500 ${fontSize}px sans-serif`;
      ctx2.translate(tile / 2, tile / 2);
      ctx2.rotate((angle * Math.PI) / 180);
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText(config.text, 0, 0);

      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  private isDark(): boolean {
    return this.core.skeleton.root.classList.contains("mach-theme-dark");
  }

  refresh(): void {
    this.apply();
  }

  destroy(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
