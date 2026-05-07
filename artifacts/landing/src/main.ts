// Sticky nav shadow
const nav = document.getElementById("nav")!;
window.addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", window.scrollY > 10);
});

// Mobile menu
const menuBtn  = document.getElementById("menu-btn")!;
const mobileMenu = document.getElementById("mobile-menu")!;
menuBtn.addEventListener("click", () => mobileMenu.classList.toggle("hidden"));
mobileMenu.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => mobileMenu.classList.add("hidden")));

// Scroll reveal
const revealObserver = new IntersectionObserver(
  (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealObserver.unobserve(e.target); } }),
  { threshold: 0.1 }
);
document.querySelectorAll(".reveal, .reveal-left, .reveal-right").forEach((el) => revealObserver.observe(el));

// Counter animation
function countUp(el: HTMLElement) {
  const target = parseInt(el.dataset.target ?? "0", 10);
  const t0 = performance.now();
  const dur = 1400;
  (function step(now: number) {
    const p = Math.min((now - t0) / dur, 1);
    const v = Math.round((1 - Math.pow(1 - p, 3)) * target);
    el.textContent = v.toLocaleString();
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target.toLocaleString() + "+";
  })(t0);
}
const counterObs = new IntersectionObserver(
  (entries) => entries.forEach((e) => { if (e.isIntersecting) { countUp(e.target as HTMLElement); counterObs.unobserve(e.target); } }),
  { threshold: 0.5 }
);
document.querySelectorAll(".counter").forEach((el) => counterObs.observe(el));
