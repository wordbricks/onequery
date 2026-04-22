# Demo Prompt: Enterprise Activation Drop

Load `onequery:internal-data-analysis`.

Investigate why enterprise activation rate dropped over the last 7 days. Use
OneQuery only, do not ask for direct database credentials, and keep every query
read-only and bounded.

Use org `acme` for the demo. Start by listing sources, then inspect the source
that looks like the warehouse. Compare the last 7 days with the previous 7 days,
break the result down by plan, signup channel, and region, then check whether
Sentry, GitHub, or Linear sources suggest a related incident or deployment.

Include the OneQuery request IDs and exact source names in the final report.

