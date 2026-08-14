import { z } from "zod";

/**
 * Wave 0 ID contract: any non-empty string so fixtures stay readable
 * (e.g. "so_ac_not_turning_on"). Wave 1 database migrations enforce UUIDs;
 * PRN IDs are always canonical — vendor IDs are secondary (#14A §7.2, kit 03).
 */
export const Id = z.string().min(1);

/** ISO 8601 timestamp with timezone, e.g. "2026-08-14T15:04:05Z". */
export const IsoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    "must be an ISO 8601 datetime with timezone"
  );

/** Calendar date, e.g. "2026-08-14". */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

/** Contract schema version, e.g. "1.0.0". */
export const SchemaVersion = z.string().min(1);

export const UsdAmount = z.number().finite().min(0);

export const Cadence = z.enum(["daily", "weekly", "monthly", "quarterly"]);
export type Cadence = z.infer<typeof Cadence>;

/**
 * Geography scope — Owner Decision D-3: the admin control panel exposes this
 * as a first-class control. Mode "national" is the trial default; "state" and
 * "county" modes require an explicit selection list.
 */
export const GeographyScope = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("national"),
    country: z.string().length(2).default("US"),
  }),
  z.object({
    mode: z.literal("state"),
    country: z.string().length(2).default("US"),
    states: z.array(z.string().length(2)).min(1),
  }),
  z.object({
    mode: z.literal("county"),
    country: z.string().length(2).default("US"),
    counties: z
      .array(z.object({ state: z.string().length(2), county: z.string().min(1) }))
      .min(1),
  }),
]);
export type GeographyScope = z.infer<typeof GeographyScope>;
