/**
 * A deliberate SQL NULL for a database function argument.
 *
 * Supabase's generated types mark every Postgres function argument as required
 * and non-null, because Postgres does not record argument nullability. Many of
 * our RPCs intentionally accept NULL (for example "no id yet: create a new
 * record" or "inherit the role permission"). Using this keeps sending `null`
 * at runtime while satisfying the generated types.
 */
export const sqlNull = null as unknown as never;
