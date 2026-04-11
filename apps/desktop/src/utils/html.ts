export const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#44;": ",",
  "&nbsp;": "\u00A0",
};
export const decodeHtmlEntities = (s: string) =>
  s
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#44);/g, (m) => ENTITY_MAP[m] ?? m)
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : _m;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : _m;
    });
export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const highlightHtmlPreservingTags = (html: string, query: string) => {
  const q = query.trim();
  if (!q) return html;
  const re = new RegExp(escapeRegExp(q), "gi");
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith("<") ? part : part.replace(re, (m) => `<mark class="search-hit">${m}</mark>`)))
    .join("");
};
export const renderHighlightedPlainText = (text: string, query: string): { __html: string } =>
  ({ __html: highlightHtmlPreservingTags(escapeHtml(decodeHtmlEntities(text)), query) });
export const rewrite5chNet = (url: string): string => url.replace(/\.5ch\.net\b/gi, ".5ch.io");

export const getAnchorIds = (el: HTMLElement): number[] => {
  const anchors = el.dataset.anchors;
  if (anchors) return anchors.split(",").map(Number).filter((n) => n > 0);
  const start = Number(el.dataset.anchor);
  const end = Number(el.dataset.anchorEnd);
  if (end > start) {
    const ids: number[] = [];
    for (let i = start; i <= end && i - start < 1000; i++) ids.push(i);
    return ids;
  }
  return start > 0 ? [start] : [];
};
export const normalizeExternalUrl = (raw: string): string | null => {
  const v = raw.replace(/&amp;/g, "&");
  let result: string | null = null;
  if (/^https?:\/\//i.test(v)) result = v;
  else if (/^ttps:\/\//i.test(v)) result = `h${v}`;
  else if (/^ttp:\/\//i.test(v)) result = `h${v}`;
  else if (/^ps:\/\//i.test(v)) result = `htt${v}`;
  else if (/^s:\/\//i.test(v)) result = `http${v}`;
  else if (/^:\/\//i.test(v)) result = `https${v}`;
  // Bare domain with path (https:// 抜き)
  else if (/^[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*\.[a-zA-Z]{2,}[/]/.test(v)) result = `https://${v}`;
  return result ? rewrite5chNet(result) : null;
};

/** Detect whether a post body is likely ASCII Art */
export const isAsciiArt = (html: string): boolean => {
  const plain = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  const lines = plain.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 3) return false;
  // Count lines with AA-characteristic patterns:
  // - 2+ consecutive fullwidth spaces (used for AA alignment)
  // - box-drawing / structural chars common in AA
  const aaChars = /[─━│┃┌┐└┘├┤┬┴┼╋▓░▒█▀▄■□◆◇○●△▽☆★♪♂♀┏┓┗┛┠┨┯┷┿╂┣┫┳┻╀╂]/;
  const fullwidthSpaces = /\u3000{2,}/;
  // Consecutive halfwidth katakana / special symbols often in AA
  const structuralPattern = /[|/\\＿＼／｜()（）{}＜＞]{3,}/;
  let aaLineCount = 0;
  for (const line of lines) {
    if (fullwidthSpaces.test(line) || aaChars.test(line) || structuralPattern.test(line)) {
      aaLineCount++;
    }
  }
  return aaLineCount / lines.length >= 0.4;
};

export const renderResponseBody = (html: string, opts?: { hideImages?: boolean; imageSizeLimitKb?: number }): { __html: string } => {
  let safe = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a\s[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "");
  safe = decodeHtmlEntities(safe);
  safe = safe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  if (opts?.hideImages) {
    // Remove image URL lines entirely
    safe = safe.split("\n").filter((line) => !/(?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/)[^\s]+\.(?:jpg|jpeg|png|gif|webp)/i.test(line)).join("\n");
  }
  safe = safe.replace(/\n/g, "<br>");
  const collectedThumbs: string[] = [];
  const sizeGated = opts?.imageSizeLimitKb && opts.imageSizeLimitKb > 0;
  if (!opts?.hideImages) {
    safe = safe.replace(
      /((?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>&"]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"]*(?:&amp;[^\s<>&"]*)*)?|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>&"]*\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"]*(?:&amp;[^\s<>&"]*)*)?)/gi,
      (match) => {
        const href = normalizeExternalUrl(match);
        if (!href) return match;
        if (sizeGated) {
          collectedThumbs.push(`<span class="thumb-link thumb-size-gate" data-lightbox-src="${href}" data-gate-src="${href}" data-size-limit="${opts.imageSizeLimitKb}"><span class="thumb-gate-loading">画像を確認中…</span></span>`);
        } else {
          collectedThumbs.push(`<span class="thumb-link" data-lightbox-src="${href}"><img class="response-thumb" src="${href}" loading="lazy" alt="" /></span>`);
        }
        return `<a class="body-link" href="${href}" target="_blank" rel="noopener">${match}</a>`;
      }
    );
  }
  // Linkify non-image URLs (must run after image thumb replacement)
  safe = safe.replace(
    /((?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/|(?<![a-zA-Z]):\/\/)[^\s<>&"]+(?:&amp;[^\s<>&"]*)*|(?<!\S)(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}\/[^\s<>&"]+(?:&amp;[^\s<>&"]*)*)/gi,
    (match) => {
      // Skip if already inside a thumb-link or img tag
      if (match.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) return match;
      const href = normalizeExternalUrl(match);
      if (!href) return match;
      return `<a class="body-link" href="${href}" target="_blank" rel="noopener">${match}</a>`;
    }
  );
  // >> range (>>2-10)
  safe = safe.replace(
    /&gt;&gt;(\d+)-(\d+)/g,
    (_m, s: string, e: string) => `<span class="anchor-ref" data-anchor="${s}" data-anchor-end="${e}" role="link" tabindex="0">&gt;&gt;${s}-${e}</span>`
  );
  // >> comma (>>2,3) — keep original display
  safe = safe.replace(
    /&gt;&gt;(\d+(?:[,、]\d+)+)/g,
    (_m, nums: string) => {
      const first = nums.split(/[,、]/)[0];
      return `<span class="anchor-ref" data-anchor="${first}" data-anchors="${nums.replace(/、/g, ",")}" role="link" tabindex="0">&gt;&gt;${nums}</span>`;
    }
  );
  // >> single (>>2)
  safe = safe.replace(
    /&gt;&gt;(\d+)/g,
    '<span class="anchor-ref" data-anchor="$1" role="link" tabindex="0">&gt;&gt;$1</span>'
  );
  // > range (>2-10)
  safe = safe.replace(
    /&gt;(\d+)-(\d+)/g,
    (_m, s: string, e: string) => `<span class="anchor-ref" data-anchor="${s}" data-anchor-end="${e}" role="link" tabindex="0">&gt;${s}-${e}</span>`
  );
  // > comma (>2,3) — keep original display
  safe = safe.replace(
    /&gt;(\d+(?:[,、]\d+)+)/g,
    (_m, nums: string) => {
      const first = nums.split(/[,、]/)[0];
      return `<span class="anchor-ref" data-anchor="${first}" data-anchors="${nums.replace(/、/g, ",")}" role="link" tabindex="0">&gt;${nums}</span>`;
    }
  );
  // > single (>2)
  safe = safe.replace(
    /&gt;(\d+)/g,
    '<span class="anchor-ref" data-anchor="$1" role="link" tabindex="0">&gt;$1</span>'
  );
  // Convert sssp:// BE icons to https:// img preview
  safe = safe.replace(
    /sssp:\/\/(img\.5ch\.net\/[^\s<>&]+|img\.5ch\.io\/[^\s<>&]+)/gi,
    (_match, path) => `<img class="be-icon" src="https://${(path as string).replace("img.5ch.net", "img.5ch.io")}" loading="lazy" alt="BE" />`
  );
  if (collectedThumbs.length > 0) {
    safe += `<div class="response-thumbs-row">${collectedThumbs.join("")}</div>`;
  }
  return { __html: safe };
};
export const renderResponseBodyHighlighted = (html: string, query: string, opts?: { hideImages?: boolean; imageSizeLimitKb?: number }): { __html: string } => {
  const rendered = renderResponseBody(html, opts).__html;
  return { __html: highlightHtmlPreservingTags(rendered, query) };
};

export const IMAGE_URL_RE = /(?:https?:\/\/|ttps?:\/\/|ps:\/\/|s:\/\/)[^\s<>&"]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>&"]*)?/gi;
export const extractImageUrls = (html: string): string[] => {
  const plain = html.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(plain);
  const matches = decoded.match(IMAGE_URL_RE);
  if (!matches) return [];
  // Normalize partial URLs
  return [...new Set(matches.map((u) => {
    if (u.startsWith("http")) return u;
    return "https://" + u.replace(/^[^/]*:\/\//, "");
  }))];
};
