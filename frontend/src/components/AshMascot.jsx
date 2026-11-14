// A lightweight, original detective mascot drawn as SVG so it stays crisp on every screen.
export default function AshMascot({ size = 42 }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" role="img" aria-label="Ash Detective mascot">
    <circle cx="32" cy="33" r="29" fill="#493529"/>
    <path d="M13 51c5-9 13-12 19-12s14 3 19 12" fill="#8B5A3B" stroke="#E8B784" strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="m25 41 7 8 7-8" fill="#E8B784"/>
    <path d="m32 49-3 8h6z" fill="#D97445"/>
    <ellipse cx="32" cy="28" rx="17" ry="16" fill="#E8B784"/>
    <path d="M13 20c4-12 9-16 19-16s15 4 19 16" fill="#302D2D" stroke="#C99460" strokeWidth="2"/>
    <path d="M8 22c9 5 39 5 48 0" stroke="#302D2D" strokeWidth="7" strokeLinecap="round"/>
    <path d="M23 28h6m7 0h6" stroke="#332824" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M28 36q4 3 8 0" stroke="#9C593F" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="41" cy="32" r="9" stroke="#F3D5A9" strokeWidth="3"/>
    <path d="m47 38 8 9" stroke="#F3D5A9" strokeWidth="4" strokeLinecap="round"/>
    <circle cx="41" cy="32" r="5" fill="#B8D2C7" fillOpacity=".23"/>
  </svg>;
}
