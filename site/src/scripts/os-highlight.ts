import { detectOs } from "../lib/os";

// Without JS the page keeps its server-rendered Windows default; this only adapts it to the visitor.
const os = detectOs({
  platform: navigator.platform,
  userAgent: navigator.userAgent,
  userAgentData: (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData,
});

if (os) {
  document.querySelectorAll<HTMLElement>("[data-recommended-for]").forEach((card) => {
    card.classList.toggle("recommended", card.dataset.recommendedFor === os);
  });

  document.querySelectorAll<HTMLAnchorElement>("[data-os-cta]").forEach((cta) => {
    const href = os === "Windows" ? cta.dataset.hrefWindows : cta.dataset.hrefLinux;
    if (href) cta.href = href;
    const label = cta.querySelector("[data-os-label]");
    if (label) label.textContent = os;
  });
}
