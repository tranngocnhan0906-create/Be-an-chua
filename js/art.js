// Hình vẽ: mèo linh vật + biểu tượng (SVG nội tuyến, dùng màu theo theme)

const INK = 'var(--cat-ink, #5a3440)';

/**
 * Mèo dễ thương. mood: 'happy' | 'normal' | 'hungry' | 'sleep' | 'love'
 * bowl: vẽ thêm bát cơm phía dưới
 */
export function cat({ size = 96, mood = 'normal', bowl = false, cls = '' } = {}) {
  const eyes = {
    normal: `<ellipse cx="44" cy="62" rx="5.2" ry="6.6" fill="${INK}"/><ellipse cx="80" cy="62" rx="5.2" ry="6.6" fill="${INK}"/>
             <circle cx="46" cy="59.5" r="1.8" fill="#fff"/><circle cx="82" cy="59.5" r="1.8" fill="#fff"/>`,
    happy: `<path d="M37 63 q7 -8 14 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
            <path d="M73 63 q7 -8 14 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    hungry: `<ellipse cx="44" cy="61" rx="6" ry="7.4" fill="${INK}"/><ellipse cx="80" cy="61" rx="6" ry="7.4" fill="${INK}"/>
             <circle cx="46.5" cy="58" r="2.4" fill="#fff"/><circle cx="82.5" cy="58" r="2.4" fill="#fff"/>
             <circle cx="42" cy="64" r="1.1" fill="#fff"/><circle cx="78" cy="64" r="1.1" fill="#fff"/>`,
    sleep: `<path d="M37 61 q7 7 14 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
            <path d="M73 61 q7 7 14 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    love: `<path d="M44 68 l-6.5 -6.5 a4.2 4.2 0 0 1 6.5 -5.3 a4.2 4.2 0 0 1 6.5 5.3 z" fill="#ff5c8a"/>
           <path d="M80 68 l-6.5 -6.5 a4.2 4.2 0 0 1 6.5 -5.3 a4.2 4.2 0 0 1 6.5 5.3 z" fill="#ff5c8a"/>`,
  }[mood] || '';
  const mouth = mood === 'hungry'
    ? `<path d="M55 77 q7 9 14 0 z" fill="#ff7aa0" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
       <path d="M68.5 80 q1.5 6 -1 8" fill="none" stroke="#8fd3ff" stroke-width="3" stroke-linecap="round"/>`
    : `<path d="M54 76 q4 5 8 0 q4 5 8 0" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const zzz = mood === 'sleep'
    ? `<text x="98" y="30" font-family="Baloo 2, Nunito, sans-serif" font-weight="800" font-size="16" fill="${INK}" opacity=".7">z</text>
       <text x="108" y="18" font-family="Baloo 2, Nunito, sans-serif" font-weight="800" font-size="12" fill="${INK}" opacity=".5">z</text>`
    : '';
  const bowlSvg = bowl
    ? `<g transform="translate(0 4)">
         <path d="M80 101 L120 77" stroke="#c98a5a" stroke-width="3.5" stroke-linecap="round"/>
         <path d="M84 105 L122 84" stroke="#c98a5a" stroke-width="3.5" stroke-linecap="round"/>
         <ellipse cx="62" cy="99" rx="34" ry="7" fill="#fff" stroke="${INK}" stroke-width="3.5"/>
         <path d="M30 99 q2 22 32 22 q30 0 32 -22" fill="var(--primary, #ff8fab)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
         <path d="M40 104 q22 8 44 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
         <circle cx="52" cy="94" r="5" fill="#fff" stroke="${INK}" stroke-width="2"/>
         <circle cx="62" cy="91" r="5.5" fill="#fff" stroke="${INK}" stroke-width="2"/>
         <circle cx="72" cy="94" r="5" fill="#fff" stroke="${INK}" stroke-width="2"/>
       </g>`
    : '';
  const h = bowl ? 130 : 112;
  return `<svg class="cat ${cls}" width="${size}" height="${Math.round(size * h / 124)}" viewBox="0 0 124 ${h}" aria-hidden="true">
    <path d="M18 54 L22 10 L52 32 Z" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M106 54 L102 10 L72 32 Z" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M26 42 L28 22 L43 34 Z" fill="#ffb3c7"/>
    <path d="M98 42 L96 22 L81 34 Z" fill="#ffb3c7"/>
    <ellipse cx="62" cy="64" rx="49" ry="41" fill="#fff" stroke="${INK}" stroke-width="4"/>
    <path d="M50 30 q6 6 12 0 q6 6 12 0" fill="none" stroke="#ffd0dc" stroke-width="3.5" stroke-linecap="round"/>
    ${eyes}
    <ellipse cx="33" cy="76" rx="8.5" ry="5.2" fill="#ff8fab" opacity=".5"/>
    <ellipse cx="91" cy="76" rx="8.5" ry="5.2" fill="#ff8fab" opacity=".5"/>
    <path d="M58.5 70.5 h7 l-3.5 4 z" fill="#ff6b93" stroke="#ff6b93" stroke-width="1.5" stroke-linejoin="round"/>
    ${mouth}
    <path d="M8 68 L25 70.5 M9 79 L25 77" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M116 68 L99 70.5 M115 79 L99 77" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    ${zzz}
    ${bowlSvg}
  </svg>`;
}

const s = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const ICONS = {
  home: s('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>'),
  calendar: s('<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><circle cx="8.5" cy="14.5" r=".9" fill="currentColor"/><circle cx="12" cy="14.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="14.5" r=".9" fill="currentColor"/>'),
  heart: s('<path d="M12 20s-7.5-4.6-9.2-9.1C1.6 7.7 3.7 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.3 0 5.4 3.2 4.2 6.4C19.5 15.4 12 20 12 20z"/>'),
  heartFill: s('<path d="M12 20s-7.5-4.6-9.2-9.1C1.6 7.7 3.7 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.3 0 5.4 3.2 4.2 6.4C19.5 15.4 12 20 12 20z" fill="currentColor"/>'),
  gear: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>', 'stroke-width="3"'),
  left: s('<path d="M15 5l-7 7 7 7"/>'),
  right: s('<path d="M9 5l7 7-7 7"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  camera: s('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.6"/>'),
  image: s('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5L6 19.5"/>'),
  chat: s('<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z"/>'),
  send: s('<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>'),
  trash: s('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>'),
  play: s('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>'),
  bell: s('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  more: s('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>'),
  share: s('<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/>'),
  fire: s('<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.1 2.2-5 3.6-6.8.9 1.6 2 2.4 2.9 2.4 0-3.2 1.2-5.6 3.2-7.4.2 3.1 4.3 5.7 4.3 11.3 0 4-3 6.7-7.5 6.7z"/>'),
  check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="3"'),
};
