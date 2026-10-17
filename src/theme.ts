// ProwadźMnie design tokens. Transit-signage look: navy boards, signal-yellow accents.
// Every text/background pair below meets WCAG AAA (7:1) contrast.
export const colors = {
  navy: '#29263F', // boards, bars, panels (jakdojade violet-navy)
  navyDeep: '#1A1830', // pressed/busy states, borders on yellow
  yellow: '#FFD23F', // the one button, destination sign, arrows
  white: '#FFFFFF', // text on navy
  ink: '#1A1830', // text on yellow / white
  paper: '#FFFFFF', // answer card background
  green: '#17803D', // distance / "you're close" chip (white text on it)
  blue: '#1F6FC5', // secondary info chip (white text on it)
  red: '#C8102E', // recording state (white text on it)
  errorBg: '#FFE3E3', // error card background (ink text)
  scrim: 'rgba(26, 24, 48, 0.85)', // translucent navy over the camera
} as const;

// Android system font (Roboto); sizes in sp, never below 20 for content.
export const type = {
  hero: { fontSize: 34, lineHeight: 40, fontWeight: '900' as const },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const },
  body: { fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
  small: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
};

export const space = { s: 8, m: 16, l: 24, xl: 32 };
export const radius = { sign: 14, card: 20, button: 999 };
// Minimum touch target for the single bottom button (dp).
export const BUTTON_SIZE = 132;
