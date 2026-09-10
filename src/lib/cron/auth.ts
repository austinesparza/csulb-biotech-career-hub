import { timingSafeEqual } from "node:crypto";

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function authorizeCronRequest(
  authorization: string | null,
  secret = process.env.CRON_SECRET,
): boolean {
  const configured = secret?.trim();
  if (!configured || configured.length < 32) return false;
  if (!authorization?.startsWith("Bearer ")) return false;
  return secureEqual(authorization.slice("Bearer ".length), configured);
}
