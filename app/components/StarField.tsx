"use client";

import { useEffect, useRef } from "react";

const STAR_COUNT = 150;

type Star = {
  /** Normalized 0–1 coordinates so stars keep their place across resizes. */
  x: number;
  y: number;
  radius: number;
  opacity: number;
};

/**
 * Static starlight dust layer. Stars are generated once and the canvas is
 * only ever repainted on resize — there is no animation loop, so the layer
 * costs zero CPU while React Flow pans and zooms above it.
 */
export default function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mostly quiet dust, with ~1 in 8 stars brighter and slightly larger so
    // the field is actually perceptible on the near-black void — while the
    // nodes and dashed edges stay the brightest layer.
    const stars: Star[] = Array.from({ length: STAR_COUNT }, () => {
      const bright = Math.random() < 0.15;
      return {
        x: Math.random(),
        y: Math.random(),
        radius: bright ? 1.4 + Math.random() * 0.7 : 0.7 + Math.random() * 0.5,
        opacity: bright ? 0.55 + Math.random() * 0.15 : 0.22 + Math.random() * 0.15,
      };
    });

    function paint() {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = canvas;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      for (const star of stars) {
        ctx.globalAlpha = star.opacity;
        ctx.fillStyle = "#ffffff";
        // Soft halo on the brighter stars; painted once, so the shadow
        // cost never touches frame time.
        ctx.shadowColor = "rgba(199, 210, 254, 0.8)";
        ctx.shadowBlur = star.opacity > 0.7 ? star.radius * 5 : 0;
        ctx.beginPath();
        ctx.arc(star.x * w, star.y * h, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    paint();

    // ResizeObserver over window.resize: also catches layout-driven size
    // changes, and fires only when this element actually changes size.
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
