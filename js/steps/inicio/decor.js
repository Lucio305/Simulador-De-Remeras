// Adornos SVG de la pantalla de bienvenida: cinta métrica, pespunte con aguja,
// botón de costura y piolín de la etiqueta.

// Cinta métrica amarilla con milímetros, medios centímetros y números.
export function tapeSVG({ fromCm = 0, cm = 34, px = 26, height = 34 } = {}) {
  const W = cm * px;
  let ticks = '';
  let nums = '';
  for (let mm = 0; mm <= cm * 10; mm++) {
    const x = (mm * px) / 10;
    const isCm = mm % 10 === 0;
    const isHalf = mm % 5 === 0;
    const h = isCm ? 13 : isHalf ? 9 : 5;
    ticks += `M${x.toFixed(1)} 0v${h}`;
    if (isCm && mm > 0) {
      const n = fromCm + mm / 10;
      nums += `<text x="${(x - 2).toFixed(1)}" y="27" text-anchor="end">${n}</text>`;
    }
  }
  return `<svg class="ini-tape-svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
    <defs>
      <linearGradient id="iniTapeG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f7d86a"/><stop offset=".55" stop-color="#f0c845"/><stop offset="1" stop-color="#d9ad2c"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${height}" fill="url(#iniTapeG)"/>
    <rect y="${height - 2}" width="${W}" height="2" fill="rgba(120,80,10,.35)"/>
    <path d="${ticks}" stroke="#3a2c1c" stroke-width="1" fill="none" opacity=".85"/>
    <g fill="#3a2c1c" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-size="11" font-weight="700">${nums}</g>
    <g fill="#c0392b" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-size="8" font-weight="800" opacity=".75">
      <text x="${(px * 10 - 4).toFixed(1)}" y="${height - 5}" text-anchor="end">▼</text>
    </g>
  </svg>`;
}

// Pespunte ondulado que termina en una aguja enhebrada.
export function stitchSVG() {
  return `<svg class="ini-stitch" viewBox="0 0 560 46" aria-hidden="true">
    <path class="ini-stitch-line" d="M4 26 C 80 8, 150 40, 230 24 S 380 10, 452 24" fill="none" stroke="#d2553f" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="11 8"/>
    <path d="M452 24 C 470 27, 482 30, 494 30" fill="none" stroke="#d2553f" stroke-width="1.6" stroke-linecap="round"/>
    <g transform="translate(492 31) rotate(-17)">
      <path d="M0 -2.2 L58 -0.9 Q63 0 58 0.9 L0 2.2 Q-2.5 0 0 -2.2Z" fill="#c9cdd3" stroke="#8b9097" stroke-width=".8"/>
      <ellipse cx="6" cy="0" rx="4" ry="1.1" fill="#fffaf2" stroke="#8b9097" stroke-width=".6"/>
      <path d="M2 -0.4 C 8 -6, 20 -9, 30 -6" fill="none" stroke="#d2553f" stroke-width="1.4" stroke-linecap="round"/>
    </g>
  </svg>`;
}

// Botón de costura con 4 agujeros e hilo cruzado (adorno del título).
export function buttonSVG() {
  return `<svg class="ini-button" viewBox="-40 -40 80 80" aria-hidden="true">
    <defs>
      <radialGradient id="iniBtnG" cx=".38" cy=".32" r=".8">
        <stop offset="0" stop-color="#ea7a63"/><stop offset=".7" stop-color="#d2553f"/><stop offset="1" stop-color="#a63e2c"/>
      </radialGradient>
    </defs>
    <circle r="36" fill="url(#iniBtnG)"/>
    <circle r="29" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
    <circle r="25" fill="rgba(0,0,0,.08)"/>
    <g fill="#5e2418">
      <circle cx="-8" cy="-8" r="3.6"/><circle cx="8" cy="-8" r="3.6"/><circle cx="-8" cy="8" r="3.6"/><circle cx="8" cy="8" r="3.6"/>
    </g>
    <g stroke="#fff3df" stroke-width="2.8" stroke-linecap="round">
      <path d="M-8 -8 L-8 8"/><path d="M8 -8 L8 8"/>
    </g>
  </svg>`;
}

// Piolín que sube desde el ojal de la etiqueta.
export function stringSVG() {
  return `<svg class="ini-string" viewBox="0 0 120 150" preserveAspectRatio="none" aria-hidden="true">
    <path d="M58 150 C 52 110, 38 70, 46 0" fill="none" stroke="#8a6a48" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M62 150 C 70 108, 86 66, 74 0" fill="none" stroke="#9b7a55" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M58 150 C 52 110, 38 70, 46 0" fill="none" stroke="#5e452c" stroke-width="2.6" stroke-dasharray="1.5 3.5" opacity=".55"/>
    <path d="M62 150 C 70 108, 86 66, 74 0" fill="none" stroke="#5e452c" stroke-width="2.6" stroke-dasharray="1.5 3.5" opacity=".55"/>
  </svg>`;
}
