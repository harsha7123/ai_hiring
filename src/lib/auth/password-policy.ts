// Validation only — Supabase Auth stores and hashes the password itself.
// Enforces a stronger minimum than Supabase's own default (6 characters).
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Use letters and at least one number.";
  return null;
}
