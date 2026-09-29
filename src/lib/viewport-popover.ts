export interface PopoverRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ViewportPopoverPlacement {
  left: number;
  top: number;
  /** Set only when the panel must shrink, or when matching the anchor. */
  width?: number;
  maxWidth: number;
  maxHeight: number;
  side: 'top' | 'bottom';
}

/**
 * Align an anchored menu to its trigger while keeping the whole panel inside
 * the visible viewport. Defaults preserve the former below/right alignment;
 * constrained viewports clamp horizontally and flip above when needed.
 */
export function positionViewportPopover({
  anchor,
  panel,
  viewportWidth,
  viewportHeight,
  align = 'end',
  matchAnchorWidth = false,
  margin = 10,
  gap = 8,
}: {
  anchor: PopoverRect;
  panel: Pick<PopoverRect, 'width' | 'height'>;
  viewportWidth: number;
  viewportHeight: number;
  align?: 'start' | 'end';
  matchAnchorWidth?: boolean;
  margin?: number;
  gap?: number;
}): ViewportPopoverPlacement {
  const maxWidth = Math.max(0, viewportWidth - margin * 2);
  const width = Math.min(maxWidth, matchAnchorWidth ? anchor.width : panel.width);
  const widthOverride = matchAnchorWidth || panel.width > maxWidth ? width : undefined;
  const leftEdge = align === 'start' ? anchor.left : anchor.right - width;
  const left = Math.min(Math.max(leftEdge, margin), Math.max(margin, viewportWidth - margin - width));

  let maxHeight = Math.max(0, viewportHeight - margin * 2);
  let height = Math.min(panel.height, maxHeight);
  const lowerEdge = viewportHeight - margin;
  const belowTop = anchor.bottom + gap;
  const roomBelow = Math.max(0, lowerEdge - belowTop);
  const roomAbove = Math.max(0, anchor.top - gap - margin);

  let side: 'top' | 'bottom' = 'bottom';
  let top = belowTop;
  if (height <= roomBelow) {
    side = 'bottom';
  } else if (height <= roomAbove) {
    side = 'top';
    top = anchor.top - gap - height;
  } else {
    // When neither side can hold the full menu, use the roomier side and
    // constrain the panel to that space rather than overlap its trigger.
    side = roomAbove > roomBelow ? 'top' : 'bottom';
    maxHeight = Math.min(maxHeight, side === 'top' ? roomAbove : roomBelow);
    height = Math.min(panel.height, maxHeight);
    top = side === 'top' ? anchor.top - gap - height : belowTop;
  }
  top = Math.min(Math.max(top, margin), Math.max(margin, lowerEdge - height));

  return { left, top, width: widthOverride, maxWidth, maxHeight, side };
}
