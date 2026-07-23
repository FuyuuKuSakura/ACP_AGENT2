/**
 * Shared layout tokens to keep the sidebar, settings panel and right companion
 * panel visually aligned.
 */
export const PANEL_WIDTH = {
  base: 'w-72', // 18rem
  xl: 'xl:w-80', // 20rem
}

export function panelWidthClasses(): string {
  return `${PANEL_WIDTH.base} ${PANEL_WIDTH.xl}`
}
