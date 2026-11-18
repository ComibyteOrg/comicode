import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  tint: string;
}

export function Starfield() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const stars: Star[] = Array.from({ length: 160 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.25 + 0.35,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.00028 + 0.0001,
      tint: Math.random() > 0.85 ? "180,148,255" : "232,238,247",
    }));
    let raf = 0;
    let width = 0;
    let height = 0;
    let t = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    const tick = (ts: number) => {
      t = ts / 1000;
      ctx.clearRect(0, 0, width, height);
      for (const star of stars) {
        const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(t * star.speed + star.phase));
        ctx.beginPath();
        ctx.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${star.tint},${(0.22 + 0.5 * twinkle).toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="starfield" ref={wrapRef} aria-hidden="true">
      <canvas ref={canvasRef} className="starfield-canvas" />
      <div className="grid-floor" />
    </div>
  );
}
