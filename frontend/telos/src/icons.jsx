const glyphs = {
  folder: (
    <>
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l1.8 2h7a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z" />
      <path d="M3.5 10h17" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.4 15.4 4.1 4.1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  users: (
    <>
      <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
      <circle cx="10" cy="8" r="3" />
      <path d="M17 11a2.5 2.5 0 1 0 0-5M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4" />
    </>
  ),
  key: (
    <>
      <circle cx="8.5" cy="15.5" r="4.5" />
      <path d="m11.8 12.2 8.2-8.2M16.5 7.5l2 2M14 10l2 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  logout: (
    <>
      <path d="M14 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3" />
      <path d="m10 8-4 4 4 4M6 12h9" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  square: <rect x="4" y="4" width="16" height="16" rx="3" />,
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8.5Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
    </>
  ),
  sheet: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9 4.5v15M15 4.5v15" />
    </>
  ),
};

export function Icon({ name, size = 18, strokeWidth = 1.6, className = '' }) {
  const glyph = glyphs[name];
  if (!glyph) return null;
  return (
    <svg
      className={`ui-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}
