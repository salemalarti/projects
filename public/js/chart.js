// Minimal single-series SVG line chart with hover crosshair + tooltip.
// One series per chart (never two y-axes). Usage:
//   RAChart.line(container, [{ x: Date, y: number }], { format: fn })
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const COLOR = '#5a4fcf';

  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    const step0 = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
    const ticks = [];
    for (let v = Math.floor(min / step) * step; ; v += step) { ticks.push(v); if (v >= max - step * 0.001) break; }
    return ticks;
  }

  function line(container, points, opts) {
    const format = (opts && opts.format) || String;
    container.innerHTML = '';
    container.classList.add('chart');
    if (points.length < 2) {
      container.innerHTML = '<p class="state">Needs at least 2 days of history.</p>';
      return;
    }
    const W = 600, H = 260, m = { t: 10, r: 12, b: 26, l: 52 };
    const xs = points.map((p) => p.x.getTime());
    const ys = points.map((p) => p.y);
    const ticks = niceTicks(Math.min(0, ...ys), Math.max(...ys), 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const sx = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const sy = (y) => H - m.b - ((y - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': (opts && opts.label) || 'chart' });
    ticks.forEach((t) => {
      svg.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), stroke: '#eee', 'stroke-width': 1 }));
      const lbl = el('text', { x: m.l - 6, y: sy(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#888' });
      lbl.textContent = window.RA.compact(t);
      svg.appendChild(lbl);
    });
    [points[0], points[points.length - 1]].forEach((p, i) => {
      const t = el('text', { x: sx(p.x.getTime()), y: H - 8, 'text-anchor': i ? 'end' : 'start', 'font-size': 11, fill: '#888' });
      t.textContent = p.x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      svg.appendChild(t);
    });
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x.getTime()).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    svg.appendChild(el('path', { d, fill: 'none', stroke: COLOR, 'stroke-width': 2, 'stroke-linejoin': 'round' }));

    const cross = el('line', { y1: m.t, y2: H - m.b, stroke: '#bbb', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' });
    svg.appendChild(cross);
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    container.appendChild(svg);
    container.appendChild(tip);

    function move(evt) {
      const rect = svg.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const vx = ((clientX - rect.left) / rect.width) * W;
      let best = points[0];
      points.forEach((p) => { if (Math.abs(sx(p.x.getTime()) - vx) < Math.abs(sx(best.x.getTime()) - vx)) best = p; });
      const px = sx(best.x.getTime());
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      tip.style.display = 'block';
      tip.style.left = (px / W) * rect.width + 'px';
      tip.style.top = (sy(best.y) / H) * rect.height + 'px';
      tip.textContent = best.x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) + ': ' + format(best.y);
    }
    function leave() { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; }
    svg.addEventListener('mousemove', move);
    svg.addEventListener('touchmove', move, { passive: true });
    svg.addEventListener('mouseleave', leave);
  }

  window.RAChart = { line };
})();
