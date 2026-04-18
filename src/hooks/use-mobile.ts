import * as React from "react"

/**
 * Viewports below this width use the mobile sidebar (Sheet drawer).
 * Aligned with Tailwind `lg` (1024px) so tablets / narrow windows get the drawer,
 * not the collapsed desktop rail (fixes trigger appearing broken at ~820px).
 */
export const MOBILE_BREAKPOINT = 1024

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useLayoutEffect(() => {
    const mq = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
    const mql = window.matchMedia(mq)
    const update = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", update)
    update()
    return () => mql.removeEventListener("change", update)
  }, [])

  return isMobile === true
}
