/** Who operates this deployment, for the privacy notice and terms. Set per deployment in env. */
export const operator = () => ({
  name: process.env.OPERATOR_NAME || "the operator of this service",
  email: process.env.PRIVACY_CONTACT_EMAIL || null,
  grievanceOfficer: process.env.GRIEVANCE_OFFICER || null,
  updated: "12 October 2026",
});
