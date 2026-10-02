import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';

const VIDEO_SRC = '/media/jadal-launch.mp4';
const POSTER_SRC = '/media/jadal-launch-poster.jpg';

/** True when the visitor asked the system to reduce motion. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * The launch film in the home hero.
 *
 * Autoplays muted and looped, but only when the visitor has not asked for
 * reduced motion. If playback is blocked or unsupported, the poster stays on
 * screen behind a play control, so the hero never looks broken.
 */
export default function HeroVideo() {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(false);

  const autoplay = !reducedMotion;

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (!autoplay) {
      element.pause();
      setPlaying(false);
      return;
    }
    // A blocked or unsupported play() rejects; the poster and the control stay.
    element.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }, [autoplay]);

  const start = useCallback((): void => {
    const element = videoRef.current;
    if (!element) return;
    element.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }, []);

  return (
    <figure className="hero-media">
      <video
        ref={videoRef}
        className="hero-video"
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        muted
        loop
        playsInline
        preload="metadata"
        autoPlay={autoplay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        aria-label={t('home.videoLabel')}
      />
      {!playing && (
        <button type="button" className="btn hero-video-play" onClick={start}>
          <span aria-hidden="true">▶</span>
          {t('home.videoPlay')}
        </button>
      )}
    </figure>
  );
}
