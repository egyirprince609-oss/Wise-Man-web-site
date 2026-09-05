# Wise Man USSD Backend

Backend for a Ghana data-selling USSD service using:

- Arkesel USSD webhook
- Render Web Service
- NetPulse Developer API

## Current test flow

```text
WISE MAN DATA
1. Buy Data
2. Prices
3. Help
0. Exit
```

Buy Data currently goes through:

```text
Buy Data
 -> Network
 -> Bundle
 -> Recipient number
 -> Confirmation
```

The final purchase step is deliberately disabled until a payment/MoMo flow is connected. This prevents a USSD test from spending the NetPulse wallet accidentally.

## Local setup

Requires Node.js 18+.

```bash
npm install
```

Set your environment variable:

```bash
NETPULSE_API_KEY=your_private_key
```

Then:

```bash
npm start
```

The server listens on the `PORT` environment variable, defaulting to `10000`.

## Render

Create a Render Web Service from this GitHub repository.

Build Command:

```text
npm install
```

Start Command:

```text
npm start
```

Add this secret in Render Environment Variables:

```text
NETPULSE_API_KEY
```

Do NOT put the real key in GitHub.

## Arkesel callback

After Render deploys, use:

```text
https://YOUR-RENDER-SERVICE.onrender.com/ussd
```

as the Arkesel USSD endpoint.

The backend supports the JSON callback format documented by Arkesel and also accepts the older form-style `sessionId/phoneNumber/text` format.

## Health check

Open:

```text
/health
```

Expected response:

```json
{"ok":true}
```

## Important

Do not commit `.env`, API keys, webhook secrets, payment credentials, or other private credentials to GitHub.
