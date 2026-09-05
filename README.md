# Wise Man USSD — Netlify

Netlify-ready version of the Wise Man Data USSD backend.

Deploy by connecting this GitHub repository to Netlify. The USSD callback becomes:

https://YOUR-SITE.netlify.app/ussd

Add `NETPULSE_API_KEY` in Netlify Project configuration → Environment variables. Never commit the real key to GitHub.

Current flow:
WISE MAN DATA → Buy Data → Network → Bundle → Recipient → Confirmation.

The final purchase/payment step is intentionally disabled until MoMo/payment is connected, preventing test calls from spending the NetPulse wallet.
