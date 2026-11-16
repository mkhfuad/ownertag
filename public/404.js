/* 404 page: a car drives past the "404" sign. Text characters only, in a <pre>.
   frame(t) is a pure function of time, so ?t=<ms> renders one exact frame for checking.
   12 fps on purpose (it should feel hand-cranked); pauses when the tab is hidden;
   with "reduce motion" the markup's parked car simply stays. */
const COLS = 40, FPS = 12, CELL_MS = 110;                      // one cell every 110 ms
const CAR = ['  ______', ' /|_||_\\`.__', '(   _    _ _\\', "=`-(_)--(_)-'"];
const CAR_W = Math.max(...CAR.map(r => r.length));
const SCENE = [
  '                           .-----.',
  '                           | 404 |',
  "                           '--+--'",
  '                              |',
  '                              |',
].map(r => r.padEnd(COLS));
const ROAD = '- '.repeat(COLS / 2);

function frame(t) {
  const x = Math.floor(t / CELL_MS) % (COLS + CAR_W) - CAR_W;  // enters from the left, leaves right, repeats
  const rows = SCENE.map(r => [...r]);
  CAR.forEach((line, i) => {
    const first = line.search(/\S/);                           // the car is solid between its outline
    for (let c = first; c < line.length; c++) {
      const col = x + c;
      if (col >= 0 && col < COLS) rows[i + 1][col] = line[c];
    }
  });
  return rows.map(r => r.join('')).join('\n') + '\n' + ROAD;
}

const road = document.getElementById('road');
const seek = new URLSearchParams(location.search).get('t');
const still = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
if (seek !== null) road.textContent = frame(parseFloat(seek));
else if (!still) {
  let last = 0, shown = '';
  const tick = (now) => {
    if (!document.hidden && now - last >= 1000 / FPS) {
      last = now;
      const s = frame(now);
      if (s !== shown) road.textContent = shown = s;
    }
    requestAnimationFrame(tick);                               // rAF itself stops in a background tab
  };
  requestAnimationFrame(tick);
}
