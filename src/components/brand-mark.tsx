export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <rect width="30" height="30" rx="4" fill="#0A1628" />
      <path d="M5 9h20" stroke="#00C4A7" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 15h20" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 21h20" stroke="#00C4A7" strokeWidth="2" strokeLinecap="round" />
      <rect x="9" y="7" width="7" height="4" rx="1" fill="#00C4A7" />
      <rect x="17" y="13" width="5" height="4" rx="1" fill="#F5A623" />
      <rect x="11" y="19" width="10" height="4" rx="1" fill="#00C4A7" />
    </svg>
  );
}
