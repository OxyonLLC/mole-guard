// Strict boolean for environment variables.
//
// `z.coerce.boolean()` is `Boolean(value)`, so the STRING "false" (and "0",
// "no", "off") became `true`. With MAINTENANCE_MODE=false in production, the
// Mole Guard's heartbeats claimed planned maintenance, and the watchdog would
// have reported a real outage as "🟡 MAINTENANCE … offline (planned)" instead
// of "🔴 OFFLINE". Found 2026-11-12 while testing the zod 4 migration.
//
//   unset            -> the default
//   ""               -> false            (unchanged from Boolean(""))
//   true/1/yes/on    -> true             (case-insensitive, trimmed)
//   false/0/no/off   -> false
//   anything else    -> validation error (it used to be silently true)
//
// Works unchanged on zod 3.25 and zod 4.
import { z } from 'zod';

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['', '0', 'false', 'no', 'off']);

export function envBool(defaultValue) {
  return z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return defaultValue;
      if (typeof value === 'boolean') return value;
      const s = value.trim().toLowerCase();
      if (TRUE.has(s)) return true;
      if (FALSE.has(s)) return false;
      ctx.addIssue({ code: 'custom', message: 'expected true/false, 1/0, yes/no or on/off' });
      return z.NEVER;
    });
}
