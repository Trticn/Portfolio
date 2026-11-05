const root = document.querySelector<HTMLElement>(".walker");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (root && !reduce) {
  const gaze = root.querySelector<HTMLElement>(".walker-gaze");
  let x = Math.min(window.innerWidth * 0.18, 160);
  let px = -9999;
  let py = -9999;
  let live = false;
  let facingLeft = false;
  let lookUpUntil = 0;
  let hopUntil = 0;
  let dodgeX: number | null = null;
  let lastScroll = window.scrollY;
  let frame = 0;

  const clamp = (value: number, max: number) => Math.min(max, Math.max(12, value));

  const tick = (now: number) => {
    if (document.hidden) return;
    const width = root.offsetWidth || 54;
    const maxX = Math.max(12, window.innerWidth - width - 12);
    const span = Math.max(0, maxX - 12);
    const patrol = 12 + (0.5 + 0.5 * Math.sin(now / 5200)) * span;
    const cx = x + width / 2;
    const cy = window.innerHeight - 36;
    const nearBottom = live && py > window.innerHeight * 0.58;
    const dist = Math.hypot(px - cx, py - cy);
    const close = nearBottom && dist < 52;

    if (close && dodgeX === null) {
      const dir = px < cx ? 1 : -1;
      dodgeX = clamp(x + dir * 78, maxX);
      hopUntil = now + 380;
    }
    if (!close && now > hopUntil) dodgeX = null;

    let goal = patrol;
    if (dodgeX !== null) goal = dodgeX;
    else if (nearBottom) goal = clamp(px - width / 2, maxX);

    const delta = goal - x;
    x += delta * (nearBottom || dodgeX !== null ? 0.075 : 0.018);
    x = clamp(x, maxX);
    if (delta > 1.2) facingLeft = false;
    if (delta < -1.2) facingLeft = true;

    root.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    const moving = Math.abs(delta) > 1.6;
    root.classList.toggle("is-moving", moving);
    root.classList.toggle("is-left", facingLeft);
    root.classList.toggle("is-hop", now < hopUntil);
    root.classList.toggle("is-reaching", nearBottom && !moving && now > hopUntil);
    root.classList.toggle("is-alert", now < lookUpUntil);

    let gx = 0;
    let gy = 0;
    if (now < lookUpUntil) gy = -3.4;
    else if (live) {
      const dx = px - cx;
      const dy = py - cy;
      const reach = Math.min(1, Math.hypot(dx, dy) / 420);
      const ang = Math.atan2(dy, dx);
      const amount = 0.4 + reach * 0.6;
      gx = Math.cos(ang) * 3.4 * amount;
      gy = Math.sin(ang) * 2.5 * amount;
    }
    if (gaze) {
      const lookX = facingLeft ? -gx : gx;
      gaze.style.transform = `translate(calc(-50% + ${lookX.toFixed(2)}px), calc(-50% + ${gy.toFixed(2)}px))`;
    }
    frame = requestAnimationFrame(tick);
  };

  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      px = e.clientX;
      py = e.clientY;
      live = true;
    },
    { passive: true },
  );
  document.documentElement.addEventListener("mouseleave", () => {
    live = false;
  });
  window.addEventListener(
    "scroll",
    () => {
      if (Math.abs(window.scrollY - lastScroll) > 10) lookUpUntil = performance.now() + 460;
      lastScroll = window.scrollY;
    },
    { passive: true },
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(frame);
    else frame = requestAnimationFrame(tick);
  });
  frame = requestAnimationFrame(tick);
}
