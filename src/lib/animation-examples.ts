// Built-in example animations for the Animations panel (loaded with the panel, never
// on first load). Each is a plain script, exactly as someone would paste it.

/** The samurai mark (src/assets/samurai.svg, 32×32), as a canvas path. */
const HELMET = 'M26.1,14.16l3.73-5.61a1,1,0,0,0-1.28-1.44L23.61,9.57A8,8,0,0,0,19,4.6,1.74,1.74,0,0,0,17.24,3H14.76A1.74,1.74,0,0,0,13,4.6a8,8,0,0,0-4.63,5L3.45,7.11A1,1,0,0,0,2.17,8.55L5.9,14.16,2,26.71a1,1,0,0,0,.16.88A1,1,0,0,0,3,28H8a1,1,0,0,0,1-.85l.32-2.06A7.87,7.87,0,0,0,14.42,27h3.16a7.87,7.87,0,0,0,5.11-1.91L23,27.15A1,1,0,0,0,24,28h5a1,1,0,0,0,.8-.41,1,1,0,0,0,.16-.88ZM21.64,10H19V6.82A6,6,0,0,1,21.64,10ZM15,5h2v5H15ZM13,6.82V10H10.36A6,6,0,0,1,13,6.82ZM8.55,11.89a1.16,1.16,0,0,0,.32.08l.06,0H23.07l.06,0a1.16,1.16,0,0,0,.32-.08l2.63-1.31L24.46,13H7.54L5.92,10.58ZM21.76,19H19.32a6,6,0,0,0-6.64,0H10.24l.62-4H21.14ZM4.35,26,7.74,15H8.83L7.14,26Zm17.9-3.33A5.87,5.87,0,0,1,17.58,25H14.42a5.87,5.87,0,0,1-4.67-2.33.34.34,0,0,0-.06-.06L9.94,21H13a1,1,0,0,0,.6-.2,4,4,0,0,1,4.8,0,1,1,0,0,0,.6.2h3.06l.25,1.62A.34.34,0,0,0,22.25,22.67ZM24.86,26,23.17,15h1.09l3.39,11Z';

/**
 * A katana "shing" with a low impact under it, synthesized here (22.05 kHz
 * mono WAV) so the example shows off sound without shipping an audio file.
 */
function shingWav() {
  const rate = 22050;
  const n = Math.round(rate * 1.8);
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, n * 2, true);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const tau = 2 * Math.PI * t;
    const attack = Math.min(1, t * 400);
    // Blade ring: inharmonic partials, a slow shimmer, a long decay.
    const ring = (Math.sin(tau * 2960) * 0.45 + Math.sin(tau * 4105) * 0.3 + Math.sin(tau * 5230) * 0.15 + Math.sin(tau * 1480) * 0.25) * (0.85 + 0.15 * Math.sin(tau * 9)) * Math.exp(-t * 2.4);
    // Impact: a falling low thump and a short burst of air.
    const thump = Math.sin(2 * Math.PI * (75 * t - 12 * t * t)) * Math.exp(-t * 6);
    const air = noise() * Math.exp(-t * 28);
    const v = (ring * 0.32 + thump * 0.55 + air * 0.35) * attack;
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, v)) * 32767 * 0.9), true);
  }
  const bytes = new Uint8Array(view.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** A 5-second VDO.Samurai intro: rising sun, falling petals, a katana slash, the name. */
export function samuraiIntro() {
  return `// VDO.Samurai intro (5 s): a red sun rises in the night, cherry blossoms
// fall, a katana slash rings out, and the name writes itself in. Then the stage
// goes back to whoever was on before. Edit freely: it's an ordinary animation.
samurai.animation({
  name: 'VDO.Samurai intro',
  duration: 5,
  end: 'prev',
  microphones: 'none',

  draw(ctx, t, { w, h, duration }) {
    const clamp = (x) => Math.min(1, Math.max(0, x));
    const out = (x) => 1 - Math.pow(1 - clamp(x), 3);
    const back = (x) => { x = clamp(x); return 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2); };
    const SLASH = 1.45; // when the blade cuts (and the sound hits)
    const cx = w / 2, sunY = h * 0.4;

    // Night sky.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#07070d');
    sky.addColorStop(1, '#1c0d1a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // The sun rises into place, with a glow.
    const y = sunY + (1 - out(t / 1.6)) * 220;
    const glow = ctx.createRadialGradient(cx, y, 120, cx, y, 620);
    glow.addColorStop(0, 'rgba(255, 70, 95, 0.45)');
    glow.addColorStop(1, 'rgba(255, 70, 95, 0)');
    ctx.globalAlpha = out(t / 1.2);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e3344d';
    ctx.beginPath();
    ctx.arc(cx, y, 250, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // The helmet, in silhouette on the sun: springs in, then a small kick at the slash.
    const pop = back((t - 0.5) / 0.7);
    const kick = t > SLASH ? Math.exp(-(t - SLASH) * 9) * Math.sin((t - SLASH) * 60) * 6 : 0;
    if (pop > 0) {
      ctx.save();
      ctx.translate(cx + kick, y + 6);
      ctx.scale(10 * pop, 10 * pop);
      ctx.translate(-16, -16);
      ctx.fillStyle = '#0b0a12';
      ctx.fill(new Path2D('${HELMET}'));
      ctx.restore();
    }

    // Falling petals (Math.random is the same every frame, so each petal keeps its path).
    ctx.fillStyle = '#ffb7c5';
    for (let i = 0; i < 48; i++) {
      const x0 = Math.random() * w, y0 = Math.random() * h;
      const speed = 70 + Math.random() * 110, sway = Math.random() * 6.3, size = 9 + Math.random() * 13;
      const spin = (Math.random() - 0.5) * 3;
      const py = ((y0 + t * speed) % (h + 80)) - 40;
      const px = x0 + Math.sin(t * 1.4 + sway) * 46 - t * 36;
      ctx.save();
      ctx.globalAlpha = 0.85 * out(t / 0.8) * (0.55 + 0.45 * Math.sin(sway * 3));
      ctx.translate(px, py);
      ctx.rotate(sway + t * spin);
      ctx.beginPath();
      ctx.ellipse(0, 0, size, size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // The slash: a bright streak across the sun, and a flash.
    const s = (t - SLASH) / 0.35;
    if (s > 0 && s < 1.6) {
      const len = out(s) * 1400, fade = 1 - clamp((s - 0.6) / 1);
      ctx.save();
      ctx.translate(cx, y);
      ctx.rotate(-0.42);
      const blade = ctx.createLinearGradient(-700, 0, -700 + len, 0);
      blade.addColorStop(0, 'rgba(255,255,255,0)');
      blade.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.globalAlpha = fade;
      ctx.fillStyle = blade;
      ctx.beginPath();
      ctx.moveTo(-700, 0);
      ctx.lineTo(-700 + len, -5);
      ctx.lineTo(-700 + len, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = \`rgba(255, 255, 255, \${0.35 * Math.exp(-(t - SLASH) * 7)})\`;
      ctx.fillRect(0, 0, w, h);
    }

    // The name, letter by letter: "VDO." in white, "Samurai" in blossom pink.
    const name = 'VDO.Samurai';
    ctx.font = '800 132px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    let x = cx - ctx.measureText(name).width / 2;
    for (let i = 0; i < name.length; i++) {
      const k = out((t - SLASH - 0.15 - i * 0.06) / 0.4);
      ctx.globalAlpha = k;
      ctx.fillStyle = i < 4 ? '#ffffff' : '#ffb7c5';
      ctx.fillText(name[i], x, h * 0.83 + (1 - k) * 36);
      x += ctx.measureText(name[i]).width;
    }
    ctx.globalAlpha = out((t - 2.6) / 0.6) * 0.75;
    ctx.fillStyle = '#ececf1';
    ctx.font = '500 38px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('recorded peer to peer, rendered in full quality', cx, h * 0.83 + 70);
    ctx.textAlign = 'left';

    // Fade to black for the hand-back.
    ctx.globalAlpha = clamp((t - (duration - 0.5)) / 0.5);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  },

  // Sound and files go last, so the code above stays easy to read and edit.
  audio: [{ asset: 'shing', at: 1.45, gain: 0.9 }],
  assets: {
    shing: '${shingWav()}',
  },
});
`;
}
