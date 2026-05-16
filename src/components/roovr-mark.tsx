export function RoovrMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 88 88"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="44" cy="44" r="40" fill="#1B4332" />
      <polygon points="44,14 18,38 70,38" fill="white" />
      <rect x="24" y="38" width="40" height="26" fill="white" />
      <rect x="37" y="50" width="14" height="14" fill="#1B4332" />
      <line
        x1="74"
        y1="74"
        x2="92"
        y2="92"
        stroke="#1B4332"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <circle cx="44" cy="44" r="40" fill="none" stroke="#0D2B1F" strokeWidth="1.5" />
    </svg>
  );
}
