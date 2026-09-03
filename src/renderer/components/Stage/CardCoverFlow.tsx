import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useImageSrc } from "../../hooks/useImageSrc";

interface CoverFlowImage {
  src: string;
  title: string;
}

// 本地图片需经 useImageSrc 解析为 data URL；加载中保留占位避免布局跳动
function CoverFlowImg({ src, title }: CoverFlowImage) {
  const isLocal = !src.startsWith("data:") && !/^https?:\/\//i.test(src);
  const localSrc = useImageSrc(isLocal ? src : null);
  const resolved = isLocal ? localSrc : src;
  if (!resolved) {
    return <div className="w-full h-full rounded-xl border border-white/10" style={{ background: 'var(--bg-surface-container)' }} />;
  }
  return (
    <img
      src={resolved}
      alt={title}
      referrerPolicy="no-referrer"
      className="w-full h-full object-cover rounded-xl shadow-2xl border border-white/10"
    />
  );
}

interface CardCoverFlowProps {
  className?: string;
  images: CoverFlowImage[];
  /** 外部请求聚焦某张图（每次请求为新对象即触发，如图片卡被 X 关闭收进 CoverFlow 时） */
  focusRequest?: { index: number } | null;
}

export function CardCoverFlow({
  className = '',
  images,
  focusRequest
}: CardCoverFlowProps) {
  const [activeIndex, setActiveIndex] = useState(images.length - 1);

  // 新图到达自动聚焦最新一张；列表缩短时钳位
  useEffect(() => {
    setActiveIndex(images.length - 1);
  }, [images.length]);

  // 外部聚焦请求（收容关闭的图片卡）
  useEffect(() => {
    if (focusRequest) {
      setActiveIndex(Math.max(0, Math.min(focusRequest.index, images.length - 1)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const toPrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveIndex(prev => Math.max(0, prev - 1));
  };

  const toNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveIndex(prev => Math.min(images.length - 1, prev + 1));
  };

  const toSlide = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setActiveIndex(index);
  };

  return (
    <div className={`w-full h-full flex flex-col items-center justify-center relative overflow-hidden select-none ${className}`} style={{ perspective: '1000px' }}>
      <div className="w-full flex justify-center items-center relative h-[140px] [transform-style:preserve-3d]">
        {images.map((item, i) => {
          const isActive = activeIndex === i;
          const offset = i - activeIndex;
          const absOffset = Math.abs(offset);
          const isPast = i < activeIndex;

          return (
            <motion.div
              key={i}
              className="absolute w-[80px] aspect-[3/4] cursor-pointer"
              initial={false}
              animate={{
                x: offset * 32,
                rotateY: isActive ? 0 : (isPast ? 38 : -38),
                z: isActive ? 50 : -absOffset * 50,
                scale: isActive ? 1.1 : 1 - (absOffset * 0.08),
                opacity: absOffset > 2 ? 0 : 1 - (absOffset * 0.25)
              }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              style={{ zIndex: 100 - absOffset }}
              onClick={(e) => toSlide(e, i)}
            >
              <CoverFlowImg src={item.src} title={item.title} />
            </motion.div>
          )
        })}
      </div>

      <div className="mt-6 w-fit px-1.5 py-0.5 flex items-center gap-2 justify-center text-zinc-300 rounded-full bg-white/5 backdrop-blur-md border border-white/10 shadow-sm z-20">
        <button onClick={toPrev} className="p-1 cursor-pointer hover:bg-white/10 rounded-full transition-colors border-0 bg-transparent text-neutral-300 hover:text-white">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="flex justify-center items-center gap-1">
          {images.map((_, i) => (
            <div
              key={i}
              onClick={(e) => toSlide(e, i)}
              className={`rounded-full cursor-pointer h-1 transition-all duration-300 ${activeIndex === i ? 'w-4 bg-white' : 'w-1 bg-white/30 hover:bg-white/50'}`}>
            </div>
          ))}
        </div>
        <button onClick={toNext} className="p-1 cursor-pointer hover:bg-white/10 rounded-full transition-colors border-0 bg-transparent text-neutral-300 hover:text-white">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
