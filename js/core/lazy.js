// Build a view only when its section is about to scroll into view, so the first paint stays light.
// Each view mounts once; errors are logged without breaking the rest of the page.
export function mountWhenNear(target, mount, margin = "800px 0px") {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return;
  const run = () => Promise.resolve().then(mount).catch(err => console.error(`[view ${el.id || target}]`, err));
  if (!("IntersectionObserver" in window)) return run();
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) {
      io.disconnect();
      run();
    }
  }, { rootMargin: margin });
  io.observe(el);
}

// Run work when the browser is idle (falls back to a short timeout).
export const whenIdle = fn =>
  "requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200);
