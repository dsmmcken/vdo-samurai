// The fake 1080p screen: an editor full of small code text, scrollable.
const W = 1920, H = 1080;
export const src = document.createElement('canvas');
src.width = W; src.height = H;
export const g = src.getContext('2d');
const words = 'const let return await async function import export from if else for of new this null true false map filter reduce Promise setTimeout encoder bitrate frame track sender peer stream width height'.split(' ');
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const lines = Array.from({ length: 400 }, () => {
  const indent = Math.floor(rnd() * 4) * 2;
  return ' '.repeat(indent) + Array.from({ length: 3 + Math.floor(rnd() * 9) }, () => words[Math.floor(rnd() * words.length)]).join(' ') + (rnd() < 0.5 ? ';' : ' {');
});
const colors = ['#d4d4d4', '#569cd6', '#c586c0', '#9cdcfe', '#ce9178', '#6a9955', '#dcdcaa'];
export function draw(scroll) {
  g.fillStyle = '#1e1e1e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#252526'; g.fillRect(0, 0, 260, H);                // sidebar
  g.fillStyle = '#333'; g.fillRect(0, 0, W, 30);                     // tab bar
  g.font = '13px monospace'; g.textBaseline = 'top';
  g.fillStyle = '#ccc';
  for (let i = 0; i < 50; i++) g.fillText(`  ${['src', 'lib', 'ui', 'room.ts', 'media.ts', 'link.ts'][i % 6]}${i}`, 8, 40 + i * 20);
  g.fillText('room.ts   media.ts   link.ts   recorder.ts', 270, 9);
  const lh = 19, first = Math.floor(scroll / lh), off = scroll % lh;
  for (let i = 0; i < 56; i++) {
    const n = first + i, y = 36 + i * lh - off;
    g.fillStyle = '#858585'; g.fillText(String(n + 1).padStart(4), 270, y);
    let x = 320;
    for (const [k, w] of lines[n % lines.length].split(' ').entries()) {
      g.fillStyle = colors[(n + k) % colors.length];
      g.fillText(w + ' ', x, y);
      x += g.measureText(w + ' ').width;
    }
  }
}

