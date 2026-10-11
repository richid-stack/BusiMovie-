import React, { useId } from "react";

const PLAY = "M42 34 L42 66 Q42 70 46 68 L69 52 Q72 50 69 48 L46 32 Q42 30 42 34Z";

/** The play-button "o" on its own: the app mark. */
export function Mark({ size = 32, mono = false, className = "" }: { size?: number; mono?: boolean; className?: string }) {
  const id = useId().replace(/:/g, "");
  const fill = mono ? "currentColor" : `url(#${id})`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      {!mono && (
        <defs>
          <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#fe1d68" />
            <stop offset=".55" stopColor="#fe4928" />
            <stop offset="1" stopColor="#feaf02" />
          </linearGradient>
        </defs>
      )}
      <circle cx="50" cy="50" r="38" fill="none" stroke={fill} strokeWidth="20" />
      <path d={PLAY} fill={fill} />
    </svg>
  );
}

/**
 * BusiMovie wordmark: "busimovie" in lowercase Sora ExtraBold with the "o" drawn as a play button.
 * `size` is the font size in px. `mono` renders it in the surrounding text colour.
 */
export default function Wordmark({ className = "", size = 28, mono = false }: { className?: string; size?: number; mono?: boolean }) {
  const id = useId().replace(/:/g, "");
  const gradient = mono ? undefined : { background: "linear-gradient(95deg,#fe1d68 0%,#fe4928 55%,#feaf02 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", WebkitTextFillColor: "transparent" } as React.CSSProperties;
  const fill = mono ? "currentColor" : `url(#${id})`;
  return (
    <span
      role="img"
      aria-label="BusiMovie"
      className={`inline-flex items-center select-none whitespace-nowrap font-display font-extrabold leading-none ${className}`}
      style={{ fontSize: size, letterSpacing: "-0.055em", ...gradient }}
    >
      busim
      <svg viewBox="0 0 100 100" aria-hidden="true" style={{ width: "0.78em", height: "0.78em", margin: "0 0.02em 0 0.015em", transform: "translateY(0.02em)" }}>
        {!mono && (
          <defs>
            <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#fe1d68" />
              <stop offset=".55" stopColor="#fe4928" />
              <stop offset="1" stopColor="#feaf02" />
            </linearGradient>
          </defs>
        )}
        <circle cx="50" cy="50" r="38" fill="none" stroke={fill} strokeWidth="20" />
        <path d={PLAY} fill={fill} />
      </svg>
      vie
    </span>
  );
}
