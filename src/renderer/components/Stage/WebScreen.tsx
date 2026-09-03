import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* ─────────────────────────────────────────────────────────
 * WEB SCREEN —— 可交互网页/小游戏的 Stage 产物卡
 * 静止卡：iframe 实时渲染生成的网页（不可交互，点击即展开）；
 * hover 浮出 accent「Open」胶囊；展开为 portal 全屏查看器，
 * 查看器内网页真正可交互，Esc / 点击遮罩 / 折叠按钮收起。
 * ───────────────────────────────────────────────────────── */

function Ico({ path, size = 15, sw = 2 }: { path: React.ReactNode; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
  );
}

/* maximize-2 — two arrows out to opposite corners (open) */
const openIcon = (
  <>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </>
);

/* minimize-2 — two arrows converging to the middle (collapse) */
const collapseIcon = (
  <>
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </>
);

export function WebScreen({ title = "Web", html }: { title?: string; html: string }) {
  const [open, setOpen] = useState(false);

  // 缩略预览：iframe 按 1280×800 虚拟视口渲染，随画框宽度等比缩小（缩略而非裁切）
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1280));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 查看器打开时 Esc 收起
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="web-screen">
      {/* 静止卡：实时渲染但不可交互，点击展开 */}
      <div
        ref={frameRef}
        className="web-screen-frame"
        onClick={() => setOpen(true)}
        style={{ animation: "fade-up 380ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          className="web-screen-iframe"
          style={{ width: 1280, height: 800, transform: `scale(${scale})` }}
          tabIndex={-1}
          title={title}
        />
        <div className="web-screen-hover">
          <span className="web-screen-open" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
            <Ico size={14} path={openIcon} />
            Open
          </span>
        </div>
      </div>

      {/* 全屏查看器：portal 到 body，网页在其中可交互 */}
      {open &&
        createPortal(
          <div className="web-viewer" role="dialog" aria-modal="true" aria-label={title}>
            <div
              className="web-viewer-mask"
              style={{ animation: "fade-in-simple 180ms ease-out both" }}
              onClick={() => setOpen(false)}
            />
            <div
              className="web-viewer-panel"
              style={{ animation: "pop-in 240ms cubic-bezier(0.23,1,0.32,1) both" }}
            >
              <div className="web-viewer-bar">
                <span className="web-viewer-title">{title}</span>
                <button type="button" aria-label="Collapse" className="web-viewer-collapse" onClick={() => setOpen(false)}>
                  <Ico size={15} path={collapseIcon} />
                </button>
              </div>
              <div className="web-viewer-body">
                <iframe srcDoc={html} sandbox="allow-scripts" className="web-viewer-iframe" title={title} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
