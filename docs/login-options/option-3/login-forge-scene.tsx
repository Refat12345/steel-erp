type LoginForgeSceneProps = {
  /** Unique prefix so mobile + desktop instances don't clash SVG ids */
  idPrefix?: string;
  /** Quiet brand initials rendered as watermark */
  monogram?: string;
  /** Compact scene for phones — fewer layers */
  compact?: boolean;
};

/**
 * Flagship mill atmosphere — rebar geometry, furnace wash, FD watermark.
 * Decorative only. Motion is CSS-driven and reduced-motion aware.
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
      <div className="auth-login-grain absolute inset-0" />
      <div className="auth-login-vignette absolute inset-0" />
      <div className="auth-login-heat absolute inset-x-0 bottom-0 h-[60%]" />
      <div className="auth-login-depth absolute inset-0" />

      <div className="auth-login-fd-mark absolute inset-0 flex items-end justify-end pe-[6%] pb-[8%]">
        <span className="auth-login-fd-glyph select-none" dir="ltr">
          {monogram}
        </span>
      </div>

      <svg
        className="auth-login-rebar-svg absolute inset-0 h-full w-full"
        viewBox="0 0 800 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <defs>
          <linearGradient id={g("metal")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.52 0.02 240)" stopOpacity="0" />
            <stop offset="18%" stopColor="oklch(0.7 0.035 230)" stopOpacity="0.45" />
            <stop offset="48%" stopColor="oklch(0.95 0.01 240)" stopOpacity="0.9" />
            <stop offset="55%" stopColor="oklch(0.78 0.04 220)" stopOpacity="0.55" />
            <stop offset="82%" stopColor="oklch(0.68 0.03 240)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="oklch(0.5 0.02 240)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={g("shine")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="47%" stopColor="white" stopOpacity="0" />
            <stop offset="50%" stopColor="white" stopOpacity="0.55" />
            <stop offset="53%" stopColor="white" stopOpacity="0" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={g("ember")} cx="42%" cy="78%" r="58%">
            <stop offset="0%" stopColor="oklch(0.78 0.16 65)" stopOpacity="0.45" />
            <stop offset="40%" stopColor="oklch(0.58 0.13 50)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="oklch(0.35 0.06 45)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={g("ring")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.9 0.02 240)" stopOpacity="0.55" />
            <stop offset="45%" stopColor="oklch(0.62 0.04 230)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="oklch(0.88 0.03 220)" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        <ellipse
          className="auth-login-ember-core"
          cx="360"
          cy="800"
          rx="340"
          ry="150"
          fill={`url(#${g("ember")})`}
        />

        {!compact && (
          <g className="auth-login-rings" stroke={`url(#${g("ring")})`}>
            <circle
              className="auth-login-ring auth-login-ring-1"
              cx="640"
              cy="200"
              r="62"
              strokeWidth="1.4"
            />
            <circle
              className="auth-login-ring auth-login-ring-2"
              cx="640"
              cy="200"
              r="44"
              strokeWidth="1"
              opacity="0.5"
            />
            <circle
              className="auth-login-ring auth-login-ring-3"
              cx="640"
              cy="200"
              r="22"
              strokeWidth="1.5"
              opacity="0.35"
            />
            <circle
              className="auth-login-ring auth-login-ring-4"
              cx="150"
              cy="620"
              r="48"
              strokeWidth="1.2"
              opacity="0.65"
            />
            <circle
              className="auth-login-ring auth-login-ring-5"
              cx="150"
              cy="620"
              r="30"
              strokeWidth="1"
              opacity="0.35"
            />
          </g>
        )}

        <g
          className="auth-login-rebar-group"
          stroke={`url(#${g("metal")})`}
          strokeLinecap="round"
        >
          <line className="auth-login-rod auth-login-rod-1" x1="-60" y1="140" x2="860" y2="40" strokeWidth="2.5" />
          <line className="auth-login-rod auth-login-rod-2" x1="-60" y1="220" x2="860" y2="120" strokeWidth="1.75" opacity="0.45" />
          <line className="auth-login-rod auth-login-rod-3" x1="-60" y1="310" x2="860" y2="210" strokeWidth="5" />
          <line className="auth-login-rod auth-login-rod-4" x1="-60" y1="400" x2="860" y2="300" strokeWidth="2.25" opacity="0.6" />
          <line className="auth-login-rod auth-login-rod-5" x1="-60" y1="500" x2="860" y2="400" strokeWidth="6.5" />
          <line className="auth-login-rod auth-login-rod-6" x1="-60" y1="590" x2="860" y2="490" strokeWidth="2" opacity="0.4" />
          <line className="auth-login-rod auth-login-rod-7" x1="-60" y1="680" x2="860" y2="580" strokeWidth="3.75" opacity="0.8" />
          {!compact && (
            <line className="auth-login-rod auth-login-rod-8" x1="-60" y1="760" x2="860" y2="660" strokeWidth="2.5" opacity="0.35" />
          )}
        </g>

        <g
          className="auth-login-ribs"
          stroke="oklch(0.94 0.01 240 / 0.38)"
          strokeWidth="1.2"
          strokeLinecap="round"
        >
          {Array.from({ length: compact ? 10 : 18 }, (_, i) => {
            const x = 30 + i * (compact ? 72 : 44);
            return <line key={i} x1={x} y1={488} x2={x + 14} y2={472} />;
          })}
        </g>

        <rect
          className="auth-login-shine"
          x="-240"
          y="0"
          width="240"
          height="900"
          fill={`url(#${g("shine")})`}
        />
      </svg>

      {!compact && <div className="auth-login-scan absolute inset-x-0 top-0 h-px" />}

      <span className="auth-login-ember auth-login-ember-1" />
      <span className="auth-login-ember auth-login-ember-2" />
      {!compact && <span className="auth-login-ember auth-login-ember-3" />}
    </div>
  );
}
