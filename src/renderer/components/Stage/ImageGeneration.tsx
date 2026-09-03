import { useImageSrc } from "../../hooks/useImageSrc";
import styles from "./ImageGeneration.module.css";

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
  const aspectRatio = w > 0 && h > 0 ? `${w} / ${h}` : "1 / 1";

  return (
    <div className={imgSrc ? `${styles.igWrap} ${styles.igDone}` : styles.igWrap}>
      <div className={styles.igCanvas} style={{ aspectRatio }} role="img" aria-label="Generating image">
        {!imgSrc && (
          <>
            <span className={styles.igDots} aria-hidden />
            <span className={styles.igGlow} aria-hidden />
          </>
        )}
        {imgSrc && <img className={styles.igImg} src={imgSrc} alt={prompt} />}
        <span className={styles.igRes}>{resolution}</span>
      </div>
      <div className={styles.igMeta}>
        <span className={styles.igLabel}>{imgSrc ? "Generated image" : "Generating image"}</span>
        <span className={styles.igPrompt}>“{prompt}”</span>
      </div>
    </div>
  );
}
