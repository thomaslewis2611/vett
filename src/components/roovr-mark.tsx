export function RoovrMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 88 88"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="44" cy="44" r="40" fill="#F1EFE8" />
      <circle cx="44" cy="44" r="40" fill="none" stroke="#2D6A4F" strokeWidth="5" />
      <polygon points="44,29 24,41 64,41" fill="#2D6A4F" />
      <rect x="28" y="41" width="32" height="18" fill="#2D6A4F" />
      <rect x="39" y="47" width="10" height="12" fill="#F1EFE8" />
      <line
        x1="76"
        y1="76"
        x2="93"
        y2="93"
        stroke="#2D6A4F"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}
