import { useImageSrc } from "../../hooks/useImageSrc";
import { GridReveal } from "./GridReveal";

// 生图卡：外层保留 Nerve 的元信息（分辨率角标 + 提示词行），
// 画框渲染交给 GridReveal——网格分裂生成中动效 → 图片浮现。
export function ImageGeneration({
  prompt = "a calm mountain lake at dawn",
  resolution = "1024 × 1024",
  src,
}: {
  prompt?: string;
  resolution?: string;
  src?: string;
}) {
  const isLocal = !!src && !src.startsWith("data:") && !/^https?:\/\//i.test(src);
  const localSrc = useImageSrc(isLocal ? src : null);
  const imgSrc = src ? (isLocal ? localSrc : src) : null;

  // 画框从生成起就是最终图片的形状
  const [w, h] = resolution.split("×").map((s) => parseFloat(s));
  const aspect = w > 0 && h > 0 ? w / h : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <div style={{ position: "relative", width: "100%" }}>
        <GridReveal
          src={imgSrc}
          alt={prompt}
          aspect={aspect}
          caption={imgSrc ? undefined : prompt}
          estimatedDuration={8000}
        />
        <span
          style={{
            position: "absolute",
            right: 6,
            bottom: 6,
            padding: "1px 6px",
            borderRadius: 5,
            background: "rgba(10, 14, 20, 0.55)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "rgba(255, 255, 255, 0.85)",
          }}
        >
          {resolution}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          minWidth: 0,
          fontSize: 11,
        }}
      >
        <span
          style={{
            flexShrink: 0,
            color: "var(--text-on-surface-variant)",
            animation: imgSrc ? "none" : "igLabelPulse 1.6s ease-in-out infinite",
          }}
        >
          {imgSrc ? "Generated image" : "Generating image"}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontStyle: "italic",
            color: "var(--text-outline)",
          }}
        >
          “{prompt}”
        </span>
      </div>
    </div>
  );
}
