const canvas = document.querySelector<HTMLCanvasElement>("[data-web]");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Anchor = { bx: number; by: number; ph: number; sp: number; x: number; y: number };
type Silk = { i: number; j: number; sag: number; phase: number; weight: number; speed: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number };
type Ring = { x: number; y: number; life: number };

const drop = document.querySelector<HTMLCanvasElement>("[data-drop]");

if (!canvas || reduce || !canvas.getContext) {
  canvas?.remove();
  drop?.remove();
} else {
  const ctx = canvas.getContext("2d");
  const dropCtx = drop?.getContext("2d") ?? null;
  if (!ctx) {
    canvas.remove();
    drop?.remove();
  } else {
    let width = 0;
    let height = 0;
    let frame = 0;
    let prevTime = 0;
    let looping = false;
    let px = -9999;
    let py = -9999;
    let over = false;
    let ceiling = 4;
    let anchors: Anchor[] = [];
    let silks: Silk[] = [];
    const sparks: Spark[] = [];
    const rings: Ring[] = [];
    const trail: { x: number; y: number }[] = [];
    const spider = { silk: 0, u: 0.22, dir: 1, step: 0, pause: 0, hops: 0, heading: 0 };
    const rappel = { u: 0, wait: 0.6, step: 0, pin: -1, done: false };
    const title = canvas.parentElement?.querySelector("h1") ?? null;

    const link = (i: number, j: number, sag: number, weight: number, speed: number) => {
      if (i === j || !anchors[i] || !anchors[j]) return;
      const key = i < j ? i * 100 + j : j * 100 + i;
      if (silks.some((s) => (s.i < s.j ? s.i * 100 + s.j : s.j * 100 + s.i) === key)) return;
      silks.push({ i, j, sag, weight, speed, phase: key * 0.17 });
    };

    const layout = () => {
      const wide = width >= 720;
      const pins = wide ? 6 : 4;
      const top = wide ? 96 : 84;
      const reach = Math.min(height * 0.22, wide ? 170 : 110);
      ceiling = pins;
      anchors = [];
      silks = [];

      for (let i = 0; i < pins; i++) {
        anchors.push({
          bx: Math.min(width * 0.94, Math.max(width * 0.06, ((i + 0.45) / pins) * width + Math.sin(i * 2.4) * width * 0.035)),
          by: top + Math.sin(i * 1.7) * 6,
          ph: i * 1.3,
          sp: 0.32 + (i % 3) * 0.07,
          x: 0,
          y: 0,
        });
      }
      const mids = pins - 1;
      for (let i = 0; i < mids; i++) {
        anchors.push({
          bx: Math.min(width * 0.9, Math.max(width * 0.1, ((i + 1) / pins) * width + Math.cos(i * 1.8) * width * 0.03)),
          by: top + reach * 0.46 + Math.sin(i * 2.1) * 8,
          ph: i * 1.9 + 2,
          sp: 0.4,
          x: 0,
          y: 0,
        });
      }
      const lows = Math.max(2, mids - 1);
      for (let i = 0; i < lows; i++) {
        anchors.push({
          bx: ((i + 1.15) / (lows + 0.8)) * width,
          by: top + reach * 0.92,
          ph: i * 2.4 + 4,
          sp: 0.28,
          x: 0,
          y: 0,
        });
      }

      const mid0 = pins;
      const low0 = pins + mids;
      for (let i = 0; i < pins - 1; i++) link(i, i + 1, wide ? 58 : 36, 1, 0.22);
      for (let i = 0; i < mids; i++) {
        link(i, mid0 + i, wide ? 28 : 16, 0.74, 0.34);
        link(i + 1, mid0 + i, wide ? 24 : 14, 0.58, 0.3);
        if (i < mids - 1) link(mid0 + i, mid0 + i + 1, wide ? 40 : 24, 0.84, 0.26);
      }
      for (let i = 0; i < lows; i++) {
        link(mid0 + i, low0 + i, wide ? 22 : 12, 0.52, 0.4);
        if (i < lows - 1) link(low0 + i, low0 + i + 1, wide ? 32 : 18, 0.66, 0.24);
      }
      if (wide) {
        link(1, mid0 + 3, 18, 0.28, 0.18);
        link(mid0, low0 + 1, 14, 0.24, 0.16);
      }
      spider.silk = 0;
      spider.u = 0.22;
      spider.dir = 1;
      rappel.pin = -1;
      trail.length = 0;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (drop && dropCtx) {
        drop.width = canvas.width;
        drop.height = canvas.height;
        dropCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        dropCtx.lineCap = "round";
        dropCtx.lineJoin = "round";
      }
      layout();
    };

    const bend = (ax: number, ay: number, bx: number, by: number, sag: number, sway: number) => {
      const ceil = height * 0.44;
      const drop = Math.min(sag, Math.max(8, ceil - (ay + by) / 2));
      return { mx: (ax + bx) / 2 + sway, my: (ay + by) / 2 + drop };
    };

    const pointAt = (ax: number, ay: number, mx: number, my: number, bx: number, by: number, u: number) => {
      const o = 1 - u;
      return {
        x: o * o * ax + 2 * o * u * mx + u * u * bx,
        y: o * o * ay + 2 * o * u * my + u * u * by,
      };
    };

    const burst = (x: number, y: number, count: number) => {
      if (y > height * 0.42 || sparks.length > 70) return;
      for (let k = 0; k < count; k++) {
        const angle = (Math.PI * 2 * k) / count + k * 0.2;
        const speed = 60 + (k % 3) * 36;
        sparks.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.6 - 24,
          life: 0,
          max: 0.34 + (k % 3) * 0.06,
        });
      }
      if (rings.length < 6) rings.push({ x, y, life: 0 });
    };

    const turnBetween = (from: number, to: number) => {
      let delta = to - from;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return delta;
    };

    const headingOf = (silk: Silk, u: number, dir: number, t: number) => {
      const pose = silkPose(silk, t, 0);
      const next = Math.min(1, Math.max(0, u + 0.04 * dir));
      const here = pointAt(pose.a.x, pose.a.y, pose.mx, pose.my, pose.b.x, pose.b.y, u);
      const there = pointAt(pose.a.x, pose.a.y, pose.mx, pose.my, pose.b.x, pose.b.y, next);
      if (Math.hypot(there.x - here.x, there.y - here.y) < 0.4) return spider.heading;
      return Math.atan2(there.y - here.y, there.x - here.x);
    };

    const hop = (at: number, t: number) => {
      const options: { idx: number; forward: boolean; turn: number }[] = [];
      silks.forEach((silk, idx) => {
        if (idx === spider.silk) return;
        const forward = silk.i === at;
        if (!forward && silk.j !== at) return;
        const leave = headingOf(silks[idx], forward ? 0 : 1, forward ? 1 : -1, t);
        options.push({ idx, forward, turn: Math.abs(turnBetween(spider.heading, leave)) });
      });
      options.sort((p, q) => p.turn - q.turn);
      const easy = options.filter((option) => option.turn < 1.7);
      const pool = easy.length ? easy : options.slice(0, 1);
      const fork = pool.length > 1 && spider.hops % 4 === 3 && pool[1].turn < pool[0].turn + 0.45;
      const pick = fork ? pool[1] : pool[0];
      spider.hops += 1;
      spider.pause = 0.38 + (pick ? pick.turn : 1.4) * 0.16;
      const here = anchors[at];
      if (here) burst(here.x, here.y, 3);
      if (!pick) {
        spider.dir *= -1;
        spider.u = Math.min(0.97, Math.max(0.03, spider.u));
        return;
      }
      spider.silk = pick.idx;
      spider.dir = pick.forward ? 1 : -1;
      spider.u = pick.forward ? 0 : 1;
    };

    const silkPose = (silk: Silk, t: number, extra: number) => {
      const a = anchors[silk.i];
      const b = anchors[silk.j];
      const sway = Math.sin(t * 0.55 + silk.phase) * (12 + silk.weight * 12);
      const sag = silk.sag * (0.84 + 0.16 * Math.sin(t * 0.5 + silk.phase)) + extra;
      const { mx, my } = bend(a.x, a.y, b.x, b.y, sag, sway);
      return { a, b, mx, my };
    };

    const drawSpider = (
      x: number,
      y: number,
      angle: number,
      scale: number,
      time: number,
      feeling: number,
      gait = spider.step,
      pen: CanvasRenderingContext2D = ctx,
    ) => {
      const bob = (1 - feeling) * Math.sin(gait) * 1.15;
      const wink = Math.pow(Math.max(0, Math.sin(time * 1.35)), 46);
      pen.save();
      pen.translate(x, y);
      pen.rotate(angle);
      pen.scale(scale, scale);
      pen.translate(bob * 0.35, bob);
      pen.fillStyle = `rgba(0, 181, 184, ${0.22 + (1 - feeling) * 0.1 * (0.5 + 0.5 * Math.sin(gait))})`;
      pen.beginPath();
      pen.arc(0, 0, 16, 0, Math.PI * 2);
      pen.fill();
      pen.strokeStyle = "#e8fffc";
      pen.lineWidth = 1.15;
      pen.lineCap = "round";
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const step = Math.sin(gait + i * 1.15 + (side < 0 ? Math.PI : 0)) * (0.42 * (1 - feeling * 0.65));
          const hip = -5 + i * 3.4 + (i === 0 ? feeling * 2.2 : 0);
          const spread = side * (0.7 + i * 0.28) + step - (i === 0 ? feeling * 0.45 * side : 0);
          const reach = i === 0 ? 8 + feeling * 7 : 8;
          const kx = hip + Math.cos(spread) * reach;
          const ky = Math.sin(spread) * reach;
          const foot = spread + side * (0.85 - feeling * 0.35);
          pen.beginPath();
          pen.moveTo(hip, side * 1.5);
          pen.lineTo(kx, ky);
          pen.lineTo(kx + Math.cos(foot) * (7 + (i === 0 ? feeling * 4 : 0)), ky + Math.sin(foot) * 7);
          pen.stroke();
        }
      }
      const belly = 1 + Math.sin(time * 2.4) * 0.06;
      pen.fillStyle = "#07080c";
      pen.strokeStyle = "#00b5b8";
      pen.lineWidth = 1.2;
      pen.beginPath();
      pen.ellipse(-6.1, Math.sin(gait - 0.7) * 0.65, 6.2, 4.4 * belly, 0, 0, Math.PI * 2);
      pen.fill();
      pen.stroke();
      pen.beginPath();
      pen.ellipse(4.2, 0, 3.8, 3.1 * (1 - wink * 0.04), 0, 0, Math.PI * 2);
      pen.fill();
      pen.stroke();
      pen.fillStyle = "#f6fffe";
      pen.beginPath();
      const eye = Math.max(0.08, 0.7 * (1 - wink));
      pen.ellipse(6.4, -1.15, 1.15, eye, -0.5, 0, Math.PI * 2);
      pen.ellipse(6.4, 1.15, 1.15, eye, 0.5, 0, Math.PI * 2);
      pen.fill();
      pen.restore();
    };

    const draw = (now: number) => {
      if (!looping) return;
      const t = now / 1000;
      const dt = Math.min(0.034, prevTime ? (now - prevTime) / 1000 : 0.016);
      prevTime = now;
      ctx.clearRect(0, 0, width, height);
      dropCtx?.clearRect(0, 0, width, height);
      const ceil = height * 0.44;

      for (const anchor of anchors) {
        let x = anchor.bx + Math.sin(t * anchor.sp + anchor.ph) * 14;
        let y = anchor.by + Math.cos(t * anchor.sp * 0.8 + anchor.ph) * 8;
        if (over && py < height * 0.48) {
          const dx = px - x;
          const dy = py - y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < 200) {
            const pull = (1 - dist / 200) ** 2 * 0.22;
            x += dx * pull;
            y += dy * pull;
          }
        }
        anchor.x = x;
        anchor.y = Math.min(y, ceil - 10);
      }

      let ride = silks[spider.silk] ?? silks[0];
      let pace = 0.35;
      if (ride && spider.pause > 0) spider.pause -= dt;
      else if (ride) {
        const a = anchors[ride.i];
        const b = anchors[ride.j];
        const span = Math.hypot(b.x - a.x, b.y - a.y) + ride.sag * 0.45;
        const remain = spider.dir > 0 ? 1 - spider.u : spider.u;
        const traveled = spider.dir > 0 ? spider.u : 1 - spider.u;
        const into = remain > 0.2 ? 1 : 0.32 + 0.68 * (remain / 0.2);
        const out = traveled > 0.14 ? 1 : 0.38 + 0.62 * (traveled / 0.14);
        pace = Math.min(into, out);
        spider.u += ((32 * dt * pace) / Math.max(48, span)) * spider.dir;
        if (spider.u >= 1) hop(ride.j, t);
        else if (spider.u <= 0) hop(ride.i, t);
      }
      ride = silks[spider.silk] ?? silks[0];
      spider.step += dt * 10 * (spider.pause > 0 ? 0.28 : pace);

      for (const silk of silks) {
        const ridden = silk === ride;
        const pose = silkPose(silk, t, ridden ? 16 : 0);
        const fade = 1 - Math.max(0, (pose.my / height - 0.34) / 0.16);
        if (fade <= 0.04) continue;
        const glow = 0.7 + 0.3 * (1 - Math.min(1, Math.hypot(pose.mx / width - 0.72, pose.my / height - 0.16) / 0.7));
        const hot = ridden ? 1 : 0.72;
        ctx.beginPath();
        ctx.moveTo(pose.a.x, pose.a.y);
        ctx.quadraticCurveTo(pose.mx, pose.my, pose.b.x, pose.b.y);
        ctx.strokeStyle = `rgba(0, 181, 184, ${0.1 * fade * silk.weight * glow * hot})`;
        ctx.lineWidth = (ridden ? 12 : 8) * silk.weight;
        ctx.stroke();
        ctx.strokeStyle = `rgba(0, 181, 184, ${(ridden ? 0.7 : 0.42) * fade * glow})`;
        ctx.lineWidth = 1.15 + silk.weight * (ridden ? 2 : 1.4);
        ctx.stroke();
        ctx.strokeStyle = `rgba(232, 255, 252, ${(ridden ? 0.95 : 0.62) * fade})`;
        ctx.lineWidth = ridden ? 1.15 : 0.75;
        ctx.stroke();

        const beadU = (t * silk.speed + silk.phase) % 1;
        const bead = pointAt(pose.a.x, pose.a.y, pose.mx, pose.my, pose.b.x, pose.b.y, beadU);
        if (bead.y < ceil) {
          ctx.fillStyle = "rgba(0, 181, 184, 0.32)";
          ctx.beginPath();
          ctx.arc(bead.x, bead.y, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
          ctx.beginPath();
          ctx.arc(bead.x, bead.y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (let i = ceiling; i < anchors.length; i += 2) {
        const anchor = anchors[i];
        if (!anchor || anchor.y > height * 0.34) continue;
        const drip = width >= 720 ? 34 : 22;
        const tipY = Math.min(anchor.y + drip, ceil);
        const tipX = anchor.x + Math.sin(anchor.ph) * 7;
        const along = 0.15 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.42 + anchor.ph));
        const drop = pointAt(anchor.x, anchor.y, anchor.x + 4, (anchor.y + tipY) / 2, tipX, tipY, along);
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y);
        ctx.quadraticCurveTo(anchor.x + 4, (anchor.y + tipY) / 2, tipX, tipY);
        ctx.strokeStyle = "rgba(232, 255, 252, 0.42)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        if (drop.y < ceil) {
          ctx.fillStyle = "rgba(0, 181, 184, 0.35)";
          ctx.beginPath();
          ctx.arc(drop.x, drop.y, 4.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(244, 255, 254, 0.95)";
          ctx.beginPath();
          ctx.arc(drop.x, drop.y, 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (ride) {
        const pose = silkPose(ride, t, 16);
        const spot = pointAt(pose.a.x, pose.a.y, pose.mx, pose.my, pose.b.x, pose.b.y, spider.u);
        const face = headingOf(ride, spider.u, spider.dir, t);
        spider.heading += turnBetween(spider.heading, face) * (1 - Math.exp(-dt * (spider.pause > 0 ? 3.4 : 7)));
        const last = trail[trail.length - 1];
        if (!last || Math.hypot(spot.x - last.x, spot.y - last.y) > 5) {
          trail.push({ x: spot.x, y: spot.y });
          if (trail.length > 18) trail.shift();
        }
        for (let i = 1; i < trail.length; i++) {
          const fade = i / trail.length;
          const droop = (index: number) => (1 - index / trail.length) * 9;
          ctx.strokeStyle = `rgba(232, 255, 252, ${0.15 + fade * 0.55})`;
          ctx.lineWidth = 0.7 + fade * 0.7;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y + droop(i - 1));
          ctx.quadraticCurveTo(
            (trail[i - 1].x + trail[i].x) / 2,
            (trail[i - 1].y + trail[i].y) / 2 + droop(i) + 4,
            trail[i].x,
            trail[i].y + droop(i),
          );
          ctx.stroke();
        }
        if (spot.y < ceil) {
          drawSpider(spot.x, spot.y, spider.heading, width < 720 ? 0.95 : 1.28, t, spider.pause > 0 ? Math.min(1, spider.pause / 0.4) : 0);
        }
      }

      if (ceiling > 0 && title) {
        const narrow = width < 720;
        const canvasTop = canvas.getBoundingClientRect().top;
        const line = title.getClientRects()[0];
        if (line) {
          const fontSize = parseFloat(getComputedStyle(title).fontSize) || line.height;
          const ink = line.height < fontSize ? line.top - (fontSize - line.height) / 2 : line.top + fontSize * 0.08;
          const name = title.previousElementSibling;
          const nameBox = name ? document.createRange() : null;
          if (nameBox && name) nameBox.selectNodeContents(name);
          const nameLeft = nameBox ? nameBox.getBoundingClientRect().left : line.left;
          const nameTop = name ? name.getBoundingClientRect().top : ink;
          const floor = (narrow ? nameTop : ink) - canvasTop - (narrow ? 24 : 20);
          const photo = canvas.parentElement?.querySelector(".hero-portrait")?.getBoundingClientRect();
          const photoLeft = photo ? photo.left - canvas.getBoundingClientRect().left : width * 0.3;
          const aimX = narrow
            ? Math.max(28, photoLeft - 32)
            : Math.max(36, Math.min(nameLeft - 34, line.left + 48));
          if (rappel.pin < 0 || rappel.pin >= ceiling) {
            rappel.pin = 0;
            for (let i = 1; i < ceiling; i++) {
              if (Math.abs(anchors[i].x - aimX) < Math.abs(anchors[rappel.pin].x - aimX)) rappel.pin = i;
            }
          }
          const pin = anchors[rappel.pin];
          if (floor > pin.y + 48) {
            const maxDrop = floor - pin.y - 8;
            if (!rappel.done) {
              if (rappel.wait > 0) rappel.wait -= dt;
              else {
                rappel.u = Math.min(1, rappel.u + dt * 0.16);
                if (rappel.u >= 1) rappel.done = true;
              }
            }
            const hanging = rappel.done;
            rappel.step += dt * (hanging || rappel.wait > 0 ? 2.2 : 9);
            const swing = Math.sin(t * (hanging ? 0.7 : 0.55)) * (narrow ? 6 : 10) * rappel.u;
            const fromX = pin.x;
            const tipX = aimX + (pin.x - aimX) * (1 - rappel.u) + swing;
            const tipY = pin.y + 10 + maxDrop * Math.max(rappel.u, 0.03);
            const pen = narrow && dropCtx ? dropCtx : ctx;
            const scale = narrow ? 0.58 : 0.72;
            const fall = Math.atan2(tipY - pin.y, tipX - fromX);
            const silkX = tipX - Math.cos(fall) * 12.3 * scale;
            const silkY = tipY - Math.sin(fall) * 12.3 * scale;
            pen.beginPath();
            pen.moveTo(fromX, pin.y);
            pen.quadraticCurveTo((fromX + silkX) / 2, (pin.y + silkY) / 2, silkX, silkY);
            pen.strokeStyle = "rgba(232, 255, 252, 0.7)";
            pen.lineWidth = 0.85;
            pen.stroke();
            drawSpider(tipX, tipY, fall, scale, t + 3, hanging ? 0.85 : rappel.wait > 0 ? 0.55 : 0.1, rappel.step, pen);
          }
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const spark = sparks[i];
        spark.life += dt;
        if (spark.life >= spark.max || spark.y > ceil) {
          sparks.splice(i, 1);
          continue;
        }
        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
        spark.vy += 80 * dt;
        const alpha = 1 - spark.life / spark.max;
        ctx.strokeStyle = `rgba(244, 255, 254, ${alpha})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(spark.x, spark.y);
        ctx.lineTo(spark.x - spark.vx * 0.04, spark.y - spark.vy * 0.04);
        ctx.stroke();
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.life += dt / 0.4;
        if (ring.life >= 1) {
          rings.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = `rgba(232, 255, 252, ${(1 - ring.life) * 0.75})`;
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, 5 + ring.life * 28, 0, Math.PI * 2);
        ctx.stroke();
      }

      frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (looping || document.hidden) return;
      looping = true;
      prevTime = 0;
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      looping = false;
      cancelAnimationFrame(frame);
    };

    resize();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const hero = canvas.parentElement;
    if (hero) {
      const watch = new IntersectionObserver(([entry]) => {
        if (entry?.isIntersecting) start();
        else stop();
      });
      watch.observe(hero);
    } else start();

    window.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType === "touch") return;
        const rect = canvas.getBoundingClientRect();
        px = e.clientX - rect.left;
        py = e.clientY - rect.top;
        over = px >= 0 && py >= 0 && px <= rect.width && py <= rect.height;
      },
      { passive: true },
    );
    document.documentElement.addEventListener("mouseleave", () => {
      over = false;
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else if (hero && hero.getBoundingClientRect().bottom > 0) start();
    });
    window.addEventListener("resize", resize, { passive: true });
  }
}
