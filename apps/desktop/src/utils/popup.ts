import { clamp } from "../constants";

export const isTextLikeInput = (el: HTMLInputElement | HTMLTextAreaElement): boolean => {
  if (el instanceof HTMLTextAreaElement) return true;
  const t = (el.type || "text").toLowerCase();
  return t === "text" || t === "search" || t === "url" || t === "email" || t === "tel" || t === "password";
};

export const getCaretClientPoint = (el: HTMLInputElement | HTMLTextAreaElement): { x: number; y: number } | null => {
  if (!isTextLikeInput(el)) return null;
  const selectionStart = el.selectionStart;
  if (selectionStart == null) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const style = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  mirror.style.position = "fixed";
  mirror.style.left = `${rect.left}px`;
  mirror.style.top = `${rect.top}px`;
  mirror.style.width = `${rect.width}px`;
  mirror.style.height = `${rect.height}px`;
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = el instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
  mirror.style.overflow = "hidden";
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.fontStyle = style.fontStyle;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.textTransform = style.textTransform;
  mirror.style.textAlign = style.textAlign as "left" | "right" | "center" | "justify";
  mirror.style.textIndent = style.textIndent;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.tabSize = style.tabSize;

  const before = el.value.slice(0, selectionStart);
  mirror.textContent = before;
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  mirror.scrollTop = el.scrollTop;
  mirror.scrollLeft = el.scrollLeft;
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();
  return {
    x: clamp(markerRect.left, rect.left + 4, rect.right - 4),
    y: clamp(markerRect.top, rect.top + 4, rect.bottom - 4),
  };
};

export const emitTypingConfetti = (x: number, y: number, count = 3) => {
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    piece.className = "typing-confetti-piece";
    const tx = (Math.random() - 0.5) * 42;
    const ty = -(18 + Math.random() * 30);
    const rot = `${Math.round((Math.random() - 0.5) * 240)}deg`;
    const hue = String(Math.floor(360 * Math.random()));
    const dur = `${420 + Math.floor(Math.random() * 220)}ms`;
    piece.style.setProperty("--x", `${x}px`);
    piece.style.setProperty("--y", `${y}px`);
    piece.style.setProperty("--tx", `${tx.toFixed(1)}px`);
    piece.style.setProperty("--ty", `${ty.toFixed(1)}px`);
    piece.style.setProperty("--rot", rot);
    piece.style.setProperty("--h", hue);
    piece.style.setProperty("--dur", dur);
    document.body.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove(), { once: true });
  }
};

export const emitDeleteExplosion = (x: number, y: number, count = 4) => {
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    piece.className = "delete-explosion-piece";
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const dist = 18 + Math.random() * 28;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    const dur = `${300 + Math.floor(Math.random() * 200)}ms`;
    piece.style.setProperty("--x", `${x}px`);
    piece.style.setProperty("--y", `${y}px`);
    piece.style.setProperty("--tx", `${tx.toFixed(1)}px`);
    piece.style.setProperty("--ty", `${ty.toFixed(1)}px`);
    piece.style.setProperty("--dur", dur);
    document.body.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove(), { once: true });
  }
};
