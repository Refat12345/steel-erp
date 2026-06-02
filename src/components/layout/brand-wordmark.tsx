import { cn } from "@/lib/utils";

const TECH_COLOR = "oklch(0.620 0.175 222)";

type BrandWordmarkProps = {
  className?: string;
  /** Larger title on login; compact label in sidebar */
  size?: "lg" | "sm";
  /** White base text on dark login background */
  variant?: "default" | "on-dark";
};

export function BrandWordmark({
  className,
  size = "lg",
  variant = "default",
}: BrandWordmarkProps) {
  const base =
    size === "lg"
      ? "text-2xl font-bold tracking-tight"
      : "text-sm font-bold tracking-tight leading-tight";

  const steelClass =
    variant === "on-dark" ? "text-white" : "text-sidebar-foreground";

  return (
    <span className={cn(base, className)} dir="ltr">
      <span className={steelClass}>steel</span>
      <span style={{ color: TECH_COLOR }}>Tech</span>
    </span>
  );
}
