// Generates the PWA / apple-touch icons from an inline SVG (no text, so no font dependency).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('public/icons');

function svg(size: number, pad: number, rounded: boolean): string {
  const s = size;
  const r = rounded ? s * 0.22 : 0;
  const inner = s - pad * 2;
  const cx = s / 2;
  const top = pad + inner * 0.26;
  const bottom = pad + inner * 0.76;
  const w = inner * 0.36;
  // An open book: two pages meeting at the spine, with a few text lines.
  const lines = [0.38, 0.47, 0.56, 0.65]
    .map((f) => {
      const y = pad + inner * f;
      return `<line x1="${cx - w * 0.78}" y1="${y}" x2="${cx - w * 0.2}" y2="${y + inner * 0.012}" />
              <line x1="${cx + w * 0.2}" y1="${y + inner * 0.012}" x2="${cx + w * 0.78}" y2="${y}" />`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" rx="${r}" fill="#1d6a63"/>
    <path d="M ${cx} ${top + inner * 0.04}
             C ${cx - w * 0.5} ${top - inner * 0.04}, ${cx - w} ${top}, ${cx - w} ${top}
             L ${cx - w} ${bottom}
             C ${cx - w} ${bottom}, ${cx - w * 0.5} ${bottom - inner * 0.05}, ${cx} ${bottom + inner * 0.02}
             C ${cx + w * 0.5} ${bottom - inner * 0.05}, ${cx + w} ${bottom}, ${cx + w} ${bottom}
             L ${cx + w} ${top}
             C ${cx + w} ${top}, ${cx + w * 0.5} ${top - inner * 0.04}, ${cx} ${top + inner * 0.04} Z"
          fill="#f5f3ee"/>
    <line x1="${cx}" y1="${top + inner * 0.05}" x2="${cx}" y2="${bottom + inner * 0.01}" stroke="#1d6a63" stroke-width="${s * 0.012}"/>
    <g stroke="#9fc4bf" stroke-width="${s * 0.016}" stroke-linecap="round">${lines}</g>
    <circle cx="${cx + w * 0.62}" cy="${pad + inner * 0.2}" r="${inner * 0.06}" fill="#ffd27a"/>
  </svg>`;
}

async function png(file: string, size: number, pad: number, rounded: boolean) {
  await sharp(Buffer.from(svg(size, pad, rounded))).png().toFile(path.join(OUT, file));
  console.log('wrote', file);
}

fs.mkdirSync(OUT, { recursive: true });
await png('icon-192.png', 192, 20, true);
await png('icon-512.png', 512, 52, true);
await png('icon-maskable-512.png', 512, 110, false);
await png('apple-touch-icon.png', 180, 18, false);
