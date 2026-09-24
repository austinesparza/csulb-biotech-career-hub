// Keep image imports type-safe when `npm run typecheck` runs before `next build`.
// Next generates next-env.d.ts at build time; CI runs typecheck first.
declare module '*.webp' {
  import type { StaticImageData } from 'next/image';
  const image: StaticImageData;
  export default image;
}
