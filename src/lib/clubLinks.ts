// Every club contact channel in one place. Channels set to null are simply
// not rendered anywhere, so there are never dead links. Fill these in as the
// club confirms them; changing this file updates the footer, About page, and
// submit page together.

export interface ClubLinks {
  email: string;
  emailSubjectReport: string;
  emailSubjectSubmit: string;
  discord: string | null;      // invite URL
  instagram: string | null;    // profile URL
  clubSite: string | null;     // main club website
  officeHours: string | null;  // human-readable, e.g. "Thursdays 12-1pm, HSCI-104"
}

export const CLUB_LINKS: ClubLinks = {
  email: 'csubiotechclub@gmail.com',
  emailSubjectReport: 'Career Hub: report a problem',
  emailSubjectSubmit: 'Career Hub: opportunity submission',
  discord: 'https://discord.gg/Yj5f4amGJv',
  instagram: 'https://www.instagram.com/csulbbiotech',
  clubSite: 'https://www.csulbbiotech.com',
  officeHours: null,
};

export function mailto(subject: string): string {
  return `mailto:${CLUB_LINKS.email}?subject=${encodeURIComponent(subject)}`;
}
