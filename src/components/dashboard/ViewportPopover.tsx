'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import { createPortal } from 'react-dom';
import { positionViewportPopover } from '@/lib/viewport-popover';

type ViewportPopoverProps = {
  open: boolean;
  anchor: HTMLElement | null;
  align?: 'start' | 'end';
  matchAnchorWidth?: boolean;
  /** On narrow viewports, use a useful panel width instead of the trigger width. */
  narrowWidth?: { maxViewport: number; width: number; margin?: number };
  className: string;
  role?: string;
  ariaLabel?: string;
  id?: string;
  testId?: string;
  panelRef?: Ref<HTMLDivElement>;
  children: React.ReactNode;
};

/** Shared viewport-aware positioning for topbar menus and search results. */
export function ViewportPopover({
  open,
  anchor,
  align = 'end',
  matchAnchorWidth = false,
  narrowWidth,
  className,
  role,
  ariaLabel,
  id,
  testId,
  panelRef,
  children,
}: ViewportPopoverProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<ReturnType<typeof positionViewportPopover> | null>(null);

  const setRefs = useCallback((node: HTMLDivElement | null) => {
    localRef.current = node;
    if (typeof panelRef === 'function') panelRef(node);
    else if (panelRef) (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [panelRef]);

  useLayoutEffect(() => {
    if (!open || !anchor) { setPlacement(null); return; }
    let naturalHeight: number | undefined;
    const update = () => {
      const panel = localRef.current;
      if (!panel || !anchor.isConnected) return;
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (naturalHeight === undefined || !panel.style.maxHeight) {
        naturalHeight = panelRect.height;
      }
      const useNarrowWidth = !!narrowWidth && window.innerWidth <= narrowWidth.maxViewport;
      const next = positionViewportPopover({
        anchor: anchorRect,
        panel: { width: panelRect.width, height: naturalHeight },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        align,
        matchAnchorWidth: useNarrowWidth ? false : matchAnchorWidth,
        preferredWidth: useNarrowWidth ? narrowWidth.width : undefined,
        margin: useNarrowWidth ? narrowWidth.margin ?? 12 : 10,
      });
      setPlacement((previous) => previous
        && previous.left === next.left
        && previous.top === next.top
        && previous.width === next.width
        && previous.maxWidth === next.maxWidth
        && previous.maxHeight === next.maxHeight
        && previous.side === next.side
        ? previous
        : next);
    };

    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(anchor);
    if (localRef.current) observer?.observe(localRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      setPlacement(null);
    };
  }, [open, anchor, align, matchAnchorWidth, narrowWidth]);

  if (!open || !anchor || typeof document === 'undefined') return null;
  const style: CSSProperties = {
    position: 'fixed',
    left: placement?.left ?? -10000,
    top: placement?.top ?? -10000,
    width: placement?.width,
    maxWidth: placement ? `${placement.maxWidth}px` : undefined,
    maxHeight: placement && placement.maxHeight < Math.max(0, window.innerHeight - 20)
      ? `${placement.maxHeight}px`
      : undefined,
    visibility: placement ? 'visible' : 'hidden',
    zIndex: 70,
  };
  // Keep workspace theme tokens while escaping clipping/scroll containers.
  const host = anchor.closest('.il-platform') || document.body;
  return createPortal(
    <div
      ref={setRefs}
      id={id}
      data-testid={testId}
      data-placement={placement?.side}
      className={`viewport-popover ${className}`}
      style={style}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    host,
  );
}
