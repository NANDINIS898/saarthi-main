export function Logo({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl"
      style={{
        width: size,
        height: size,
        background:
          "linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)",
        boxShadow: "0 4px 12px rgba(16, 185, 129, 0.35)",
      }}
      aria-label="Saarthi"
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3l2 4 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1z" />
      </svg>
    </div>
  );
}
