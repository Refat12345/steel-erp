type LoginForgeSceneProps = {
  /** Unique prefix so mobile + desktop instances don't clash SVG ids */
  idPrefix?: string;
  /** Quiet brand initials rendered as watermark */
  monogram?: string;
  /** Compact scene for phones — fewer layers */
  compact?: boolean;
};

/**
 * Illustrated mill atmosphere — geometric rebar, soft furnace wash, FD mark.
 * No photography. CSS motion; respects prefers-reduced-motion.
 */
export function LoginForgeScene({
  idPrefix = "auth",
  monogram = "FD",
  compact = false,
}: LoginForgeSceneProps) {
  const g = (name: string) => `${idPrefix}-${name}`;

  return (
    <div
      className={`auth-login-forge pointer-events-none absolute inset-0 overflow-hidden${compact ? " auth-login-forge-compact" : ""}`}
      aria-hidden
    >
      <div className="auth-login-mesh absolute inset-0" />
      <div className="auth-login-vignette absolute inset-0" />
      <div className="auth-login-heat absolute inset-x-0 bottom-0 h-[55%]" />
      <div className="auth-login-depth absolute inset-0" />

      {!compact && (
        <div className="auth-login-fd-mark absolute inset-0 flex items-end justify-end pe-[8%] pb-[10%]">
          <span className="auth-login-fd-glyph select-none" dir="ltr">
            {monogram}
          </span>
        </div>
      )}

      <svg
        className="auth-login-rebar-svg absolute inset-0 h-full w-full"
        viewBox="0 0 800 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <defs>
          <linearGradient id={g("metal")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.55 0.03 230)" stopOpacity="0" />
            <stop offset="22%" stopColor="oklch(0.72 0.04 225)" stopOpacity="0.45" />
            <stop offset="50%" stopColor="oklch(0.94 0.015 240)" stopOpacity="0.85" />
            <stop offset="78%" stopColor="oklch(0.7 0.04 222)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="oklch(0.5 0.03 230)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={g("shine")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="46%" stopColor="white" stopOpacity="0" />
            <stop offset="50%" stopColor="white" stopOpacity="0.4" />
            <stop offset="54%" stopColor="white" stopOpacity="0" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={g("ember")} cx="40%" cy="85%" r="55%">
            <stop offset="0%" stopColor="oklch(0.75 0.15 65)" stopOpacity="0.35" />
            <stop offset="45%" stopColor="oklch(0.55 0.12 50)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="oklch(0.35 0.06 45)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={g("ring")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.88 0.03 220)" stopOpacity="0.5" />
            <stop offset="50%" stopColor="oklch(0.6 0.04 230)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="oklch(0.85 0.03 225)" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        <ellipse
          className="auth-login-ember-core"
          cx="340"
          cy="820"
          rx="300"
          ry="120"
          fill={`url(#${g("ember")})`}
        />

        {!compact && (
          <g className="auth-login-rings" stroke={`url(#${g("ring")})`}>
            <circle className="auth-login-ring auth-login-ring-1" cx="640" cy="210" r="58" strokeWidth="1.4" />
            <circle className="auth-login-ring auth-login-ring-2" cx="640" cy="210" r="40" strokeWidth="1" opacity="0.5" />
            <circle className="auth-login-ring auth-login-ring-3" cx="640" cy="210" r="20" strokeWidth="1.4" opacity="0.35" />
            <circle className="auth-login-ring auth-login-ring-4" cx="160" cy="600" r="46" strokeWidth="1.2" opacity="0.65" />
            <circle className="auth-login-ring auth-login-ring-5" cx="160" cy="600" r="28" strokeWidth="1" opacity="0.35" />
          </g>
        )}

        <g
          className="auth-login-rebar-group"
          stroke={`url(#${g("metal")})`}
          strokeLinecap="round"
        >
          <line className="auth-login-rod auth-login-rod-1" x1="-50" y1="150" x2="850" y2="55" strokeWidth="2.5" />
          <line className="auth-login-rod auth-login-rod-2" x1="-50" y1="230" x2="850" y2="135" strokeWidth="1.75" opacity="0.45" />
          <line className="auth-login-rod auth-login-rod-3" x1="-50" y1="320" x2="850" y2="225" strokeWidth="5" />
          <line className="auth-login-rod auth-login-rod-4" x1="-50" y1="410" x2="850" y2="315" strokeWidth="2.25" opacity="0.6" />
          <line className="auth-login-rod auth-login-rod-5" x1="-50" y1="510" x2="850" y2="415" strokeWidth="6" />
          <line className="auth-login-rod auth-login-rod-6" x1="-50" y1="600" x2="850" y2="505" strokeWidth="2" opacity="0.4" />
          <line className="auth-login-rod auth-login-rod-7" x1="-50" y1="690" x2="850" y2="595" strokeWidth="3.5" opacity="0.8" />
          {!compact && (
            <line className="auth-login-rod auth-login-rod-8" x1="-50" y1="770" x2="850" y2="675" strokeWidth="2.25" opacity="0.35" />
          )}
        </g>

        <g
          className="auth-login-ribs"
          stroke="oklch(0.94 0.01 240 / 0.35)"
          strokeWidth="1.15"
          strokeLinecap="round"
        >
          {Array.from({ length: compact ? 10 : 16 }, (_, i) => {
            const x = 40 + i * (compact ? 70 : 46);
            return <line key={i} x1={x} y1={498} x2={x + 13} y2={482} />;
          })}
        </g>

        <rect
          className="auth-login-shine"
          x="-220"
          y="0"
          width="220"
          height="900"
          fill={`url(#${g("shine")})`}
        />
      </svg>

      {!compact && <div className="auth-login-scan absolute inset-x-0 top-0 h-px" />}
    </div>
  );
}
