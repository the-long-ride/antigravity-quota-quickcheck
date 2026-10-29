/**
 * Custom floating tooltip implementation for desktop app panel.
 * Replaces native browser title attributes with sleek, themed,
 * edge-clamped floating tooltips.
 */

export interface TooltipPosition {
  left: number;
  top: number;
  placement: "top" | "bottom";
}

export interface RectLike {
  left: number;
  top: number;
  right?: number;
  bottom?: number;
  width: number;
  height: number;
}

export function calculateTooltipPosition(
  targetRect: RectLike,
  tooltipRect: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 6
): TooltipPosition {
  const bottom = targetRect.bottom ?? (targetRect.top + targetRect.height);
  const roomAbove = targetRect.top - gap - margin;

  let placement: "top" | "bottom" = "top";
  let top: number;

  // Decide placement:
  // If target is very close to top (header area, targetRect.top < 50px), place below target
  // Else if room above is sufficient (>= tooltip height), place above target
  // Otherwise place below target
  if (targetRect.top < 50 || roomAbove < tooltipRect.height) {
    placement = "bottom";
    top = bottom + gap;
  } else {
    placement = "top";
    top = targetRect.top - tooltipRect.height - gap;
  }

  // Strictly clamp vertical position within [margin, viewport.height - tooltipRect.height - margin]
  const maxTop = Math.max(margin, viewport.height - tooltipRect.height - margin);
  top = Math.max(margin, Math.min(maxTop, top));

  // Horizontal position: center relative to target
  const targetCenterX = targetRect.left + (targetRect.width / 2);
  let left = targetCenterX - (tooltipRect.width / 2);

  // Strictly clamp horizontal position within [margin, viewport.width - tooltipRect.width - margin]
  const maxLeft = Math.max(margin, viewport.width - tooltipRect.width - margin);
  left = Math.max(margin, Math.min(maxLeft, left));

  return {
    left: Math.round(left),
    top: Math.round(top),
    placement,
  };
}

export function initFloatingTooltips(): () => void {
  let tooltipEl = document.getElementById("app-floating-tooltip");
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "app-floating-tooltip";
    tooltipEl.className = "floating-tooltip";
    tooltipEl.setAttribute("role", "tooltip");
    tooltipEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(tooltipEl);
  }

  let showTimer: number | null = null;
  let currentTarget: HTMLElement | null = null;

  function hideTooltip() {
    if (showTimer !== null) {
      window.clearTimeout(showTimer);
      showTimer = null;
    }
    currentTarget = null;
    if (tooltipEl) {
      tooltipEl.classList.remove("visible", "measuring");
      tooltipEl.setAttribute("aria-hidden", "true");
    }
  }

  function getTooltipText(el: HTMLElement): string | null {
    if (el.hasAttribute("title")) {
      const title = el.getAttribute("title");
      if (title && title.trim()) {
        el.setAttribute("data-tooltip", title.trim());
      }
      el.removeAttribute("title");
    }
    const val = el.getAttribute("data-tooltip");
    return val && val.trim() ? val.trim() : null;
  }

  function showTooltipFor(target: HTMLElement) {
    if (!tooltipEl) return;
    const text = getTooltipText(target);
    if (!text) {
      hideTooltip();
      return;
    }

    tooltipEl.textContent = text;
    tooltipEl.classList.remove("visible");
    tooltipEl.classList.add("measuring");

    // Force layout measurement
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth || 598,
      height: window.innerHeight || document.documentElement.clientHeight || 470,
    };

    const pos = calculateTooltipPosition(targetRect, tooltipRect, viewport);

    tooltipEl.style.left = `${pos.left}px`;
    tooltipEl.style.top = `${pos.top}px`;
    tooltipEl.dataset.placement = pos.placement;
    tooltipEl.classList.remove("measuring");
    tooltipEl.classList.add("visible");
    tooltipEl.setAttribute("aria-hidden", "false");
  }

  function onMouseOver(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-tooltip], [title], button, a"
    );
    if (!target) return;
    if (currentTarget === target) return;

    // Convert title to data-tooltip immediately so browser tooltip never triggers
    if (target.hasAttribute("title")) {
      const t = target.getAttribute("title");
      if (t && t.trim()) target.setAttribute("data-tooltip", t.trim());
      target.removeAttribute("title");
    }

    const text = target.getAttribute("data-tooltip");
    if (!text) return;

    currentTarget = target;
    if (showTimer !== null) {
      window.clearTimeout(showTimer);
    }
    showTimer = window.setTimeout(() => {
      if (currentTarget === target) {
        showTooltipFor(target);
      }
    }, 150);
  }

  function onMouseOut(e: MouseEvent) {
    const related = e.relatedTarget as HTMLElement | null;
    if (currentTarget && (!related || !currentTarget.contains(related))) {
      hideTooltip();
    }
  }

  function onFocusIn(e: FocusEvent) {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-tooltip], [title], button, a"
    );
    if (!target) return;
    currentTarget = target;
    showTooltipFor(target);
  }

  function onFocusOut() {
    hideTooltip();
  }

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("click", hideTooltip, true);
  window.addEventListener("blur", hideTooltip);

  return () => {
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    document.removeEventListener("click", hideTooltip, true);
    window.removeEventListener("blur", hideTooltip);
    if (tooltipEl && tooltipEl.parentNode) {
      tooltipEl.parentNode.removeChild(tooltipEl);
    }
  };
}
