export function Logo({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl bg-[#6C63FF]"
      style={{ width: size, height: size }}
      aria-label="Saarthi"
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 26 26" fill="none">
        <circle cx="13" cy="9" r="4.5" fill="#fff" />
        <path d="M3 23c0-5 4.5-8 10-8s10 3 10 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
