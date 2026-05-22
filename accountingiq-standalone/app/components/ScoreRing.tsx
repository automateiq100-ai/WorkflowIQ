'use client';

const R = 54;
const CIRC = 2 * Math.PI * R; // ≈ 339.3

export default function ScoreRing({
  score,
  color,
  grade,
}: {
  score: number;
  color: string;
  grade: string;
}) {
  const offset = CIRC * (1 - score / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="120" height="120" viewBox="0 0 120 120">
        {/* track */}
        <circle
          cx="60" cy="60" r={R}
          fill="none"
          stroke="var(--bg4)"
          strokeWidth="8"
        />
        {/* progress */}
        <circle
          cx="60" cy="60" r={R}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          className="animate-ring"
        />
        <text
          x="60" y="56"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--text1)"
          fontSize="26"
          fontWeight="700"
          fontFamily="var(--font-outfit)"
        >
          {score}
        </text>
        <text
          x="60" y="75"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--text2)"
          fontSize="11"
          fontFamily="var(--font-outfit)"
        >
          / 100
        </text>
      </svg>
      <span
        className="text-2xl font-bold"
        style={{ color, fontFamily: 'var(--font-dm-serif)' }}
      >
        {grade}
      </span>
    </div>
  );
}
