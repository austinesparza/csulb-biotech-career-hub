export const colors = {
  paper: '#fdfbf6',
  paper2: '#f5f1e6',
  white: '#ffffff',
  navy: '#0a1628',
  ink: '#1a2008',
  inkSoft: '#464c3c',
  inkFaint: '#6a7060',
  teal: '#075672',
  tealBright: '#00c4a7',
  gold: '#f5a623',
  goldMark: '#b8710a',
  clarify: '#7e5310',
  eligible: '#3a6a1b',
  restricted: '#a3283a',
} as const;

export const dimensions = {
  status: colors.teal,
  eligibility: colors.eligible,
  restriction: colors.restricted,
  timingFill: colors.gold,
  timingMark: colors.goldMark,
  clarification: colors.clarify,
} as const;
