'use client';

// "Built with HappySeeds" watermark — HappySeeds platform component, adapted from
// their HappySeedsWatermark.tsx to plain JSX + inline styles (this project has no
// Tailwind / TypeScript). Draggable pill, never shown inside an iframe.
//
// projectId + apiBase come from the SERVER (the root layout reads process.env and
// passes them as props): a 'use client' bundle can't read non-NEXT_PUBLIC_ env
// vars, so the original module-level process.env reads were always empty (the
// watermark would never show, even deployed). In DEV we preview it
// unconditionally so the look can be verified locally; in PRODUCTION it follows
// HappySeeds' API (show_watermark).

import { useCallback, useEffect, useRef, useState } from 'react';

const WATERMARK_LINK = 'https://link.happyseeds.ai/24qkhm';
const WATERMARK_DEFAULT_OFFSET = 24;
const WATERMARK_EDGE_GAP = 12;
const DRAG_CLICK_THRESHOLD = 5;

function watermarkResponseVisible(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.success !== true) return false;
  const data = payload.data;
  if (!data || typeof data !== 'object') return false;
  return data.show_watermark === true;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampWatermarkPosition(position, element) {
  const rect = element.getBoundingClientRect();
  const maxX = Math.max(WATERMARK_EDGE_GAP, window.innerWidth - rect.width - WATERMARK_EDGE_GAP);
  const maxY = Math.max(WATERMARK_EDGE_GAP, window.innerHeight - rect.height - WATERMARK_EDGE_GAP);
  return {
    x: clamp(position.x, WATERMARK_EDGE_GAP, maxX),
    y: clamp(position.y, WATERMARK_EDGE_GAP, maxY),
  };
}

function getDefaultPosition(element) {
  const rect = element.getBoundingClientRect();
  // Bottom-CENTRE everywhere (owner): clears the match controls (legend bottom-
  // left, glass column right, touch controls in the corners) and the page
  // corners. Re-runs on resize → responsive.
  return {
    x: Math.round((window.innerWidth - rect.width) / 2),
    y: window.innerHeight - rect.height - WATERMARK_DEFAULT_OFFSET,
  };
}

export function HappySeedsWatermark({ projectId = '', apiBase = '' }) {
  const watermarkRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const hasUserMovedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [isIframe, setIsIframe] = useState(false);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      setIsIframe(window.self !== window.top);
    } catch {
      setIsIframe(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || isIframe) return;
    // Dev: preview the watermark so the look/position can be verified locally.
    if (process.env.NODE_ENV !== 'production') {
      setVisible(true);
      return;
    }
    // Production: follow HappySeeds' API gate (env passed from the server).
    if (!projectId || !apiBase) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/${projectId}/watermark`);
        const payload = await res.json().catch(() => null);
        if (!cancelled && watermarkResponseVisible(payload)) setVisible(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, isIframe, projectId, apiBase]);

  const syncPosition = useCallback(() => {
    const element = watermarkRef.current;
    if (!element) return;
    setPosition((current) => {
      const source = hasUserMovedRef.current && current ? current : getDefaultPosition(element);
      return clampWatermarkPosition(source, element);
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(syncPosition);
    const handleViewportChange = () => syncPosition();
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
    };
  }, [visible, syncPosition]);

  const handlePointerDown = (event) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const element = watermarkRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const origin = clampWatermarkPosition(position ?? { x: rect.left, y: rect.top }, element);
    setPosition(origin);
    setDragging(true);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false,
    };
    // Do NOT capture the pointer here: capturing on pointerdown sends the
    // following `click` to this div instead of the inner <a>, so a plain click
    // never navigates. Capture only once a real drag begins (handlePointerMove).
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    const element = watermarkRef.current;
    if (!drag || !element || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) >= DRAG_CLICK_THRESHOLD) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId); // capture only for the drag
    }
    if (!drag.moved) return;
    event.preventDefault();
    setPosition(clampWatermarkPosition({ x: drag.originX + dx, y: drag.originY + dy }, element));
  };

  const finishDrag = (event) => {
    const drag = dragRef.current;
    const element = watermarkRef.current;
    if (!drag || !element || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const moved = drag.moved;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!moved) return;
    event.preventDefault();
    suppressClickRef.current = true;
    const next = clampWatermarkPosition({ x: drag.originX + dx, y: drag.originY + dy }, element);
    hasUserMovedRef.current = true;
    setPosition(next);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 300);
  };

  const handleClickCapture = (event) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  };

  if (!ready || isIframe || !visible) return null;

  return (
    <div
      ref={watermarkRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onClickCapture={handleClickCapture}
      style={{
        position: 'fixed',
        zIndex: 2147483000,
        pointerEvents: 'auto',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        left: position ? `${position.x}px` : undefined,
        top: position ? `${position.y}px` : undefined,
        right: position ? undefined : `${WATERMARK_DEFAULT_OFFSET}px`,
        bottom: position ? undefined : `${WATERMARK_DEFAULT_OFFSET}px`,
        maxWidth: `calc(100vw - ${WATERMARK_EDGE_GAP * 2}px)`,
        touchAction: 'none',
        userSelect: 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          maxWidth: '100%',
          alignItems: 'stretch',
          overflow: 'hidden',
          borderRadius: '9999px',
          border: '1px solid rgba(93, 144, 56, 0.3)',
          background: '#fff7e2',
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        }}
      >
        <a
          href={WATERMARK_LINK}
          target="_blank"
          rel="noopener noreferrer"
          draggable={false}
          aria-label="Built with Neo"
          title="Built with Neo. Drag to reposition."
          style={{
            display: 'flex',
            maxWidth: '100%',
            alignItems: 'center',
            // responsive: scales with viewport width, small on phones, capped on
            // desktop. padding/gap are em-based so the whole pill scales with it.
            gap: '0.35em',
            padding: '0.5em 0.95em',
            fontSize: 'clamp(7px, 0.8vw, 10px)',
            lineHeight: 1,
            color: '#6f7d63',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: '#6f7d63' }}>Built with</span>
          <span style={{ fontWeight: 700, color: '#4f8a2f' }}>Neo</span>
        </a>
      </div>
    </div>
  );
}
