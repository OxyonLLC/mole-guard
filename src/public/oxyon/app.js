// Oxyon landing v1.1 — minimal JS by design. Content is semantic HTML;
// this file only stamps the year and runs the fade-in reveals.
document.addEventListener("DOMContentLoaded", () => {
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  // Sections simply appear — a single opacity fade, skipped entirely when
  // the visitor prefers reduced motion (CSS shows everything statically).
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targets = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) {
    targets.forEach((t) => t.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }),
    { threshold: 0.1 },
  );
  targets.forEach((t) => io.observe(t));
});
