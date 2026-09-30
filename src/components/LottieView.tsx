import lottie, { type AnimationItem } from 'lottie-web/build/player/lottie_light';
import { useEffect, useRef, useState } from 'react';

const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Returns true while the element is (nearly) on screen. */
export function useInView<T extends Element>(ref: React.RefObject<T | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

interface Props {
  /** Serialized Lottie JSON (lottie-web mutates animation data, so every load gets a fresh parse). */
  json: string;
  playing?: boolean;
  className?: string;
  label?: string;
  /** Frame shown while paused (defaults to the current/first frame). */
  frame?: number;
  /** Playback speed (1 = normal). */
  speed?: number;
  /** Jump to a frame; `n` changes on every request so the same frame can be requested again. */
  seek?: { frame: number; n: number } | null;
  /** Current frame and length, reported once per displayed frame (for a player's timeline). */
  onFrame?: (frame: number, total: number) => void;
}

export function LottieView({ json, playing = true, className, label, frame: stillFrame, speed = 1, seek, onFrame }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const loadedJson = useRef<string | null>(null);
  const inView = useInView(ref);
  const shouldPlay = playing && inView && !reducedMotion;
  const report = useRef(onFrame);
  report.current = onFrame;
  const tell = () => {
    const anim = animRef.current;
    if (anim && report.current) report.current(anim.currentFrame, anim.totalFrames);
  };

  // (Re)load only while visible — off-screen thumbnails keep their last render.
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView || loadedJson.current === json) return;
    const prev = animRef.current;
    const frame = prev ? prev.currentFrame : 0;
    prev?.destroy();
    const anim = lottie.loadAnimation({
      container: el,
      renderer: 'svg',
      loop: true,
      autoplay: false,
      animationData: JSON.parse(json),
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false },
    });
    anim.goToAndStop(stillFrame ?? (reducedMotion ? Math.round(anim.totalFrames * 0.3) : frame), true);
    anim.setSpeed(speed);
    anim.addEventListener('enterFrame', tell);
    animRef.current = anim;
    loadedJson.current = json;
    tell();
    if (shouldPlay) anim.play();
  }, [json, inView]);

  useEffect(() => {
    animRef.current?.setSpeed(speed);
  }, [speed]);

  useEffect(() => {
    const anim = animRef.current;
    if (!anim || !seek) return;
    const target = Math.max(0, Math.min(seek.frame, anim.totalFrames - 1));
    if (shouldPlay) anim.goToAndPlay(target, true);
    else anim.goToAndStop(target, true);
    tell();
  }, [seek]);

  useEffect(() => {
    const anim = animRef.current;
    if (!anim) return;
    if (shouldPlay) anim.play();
    else anim.pause();
  }, [shouldPlay]);

  useEffect(
    () => () => {
      animRef.current?.destroy();
      animRef.current = null;
      loadedJson.current = null;
    },
    [],
  );

  return <div ref={ref} className={className} role="img" aria-label={label} />;
}
