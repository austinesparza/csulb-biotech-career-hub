// Bound components so a long token without an @ cannot trigger quadratic scans.
const EMAIL = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/gi;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

/** Contact details are omitted from research packets. Not a general secret scrubber. */
export function redactContacts(value: string): string {
  return value.replace(EMAIL, "[email removed]").replace(PHONE, "[phone removed]");
}
