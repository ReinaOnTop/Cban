# WhatsApp Ban Checker (Vercel-ready)

Files:
- api/check-ban.js : Vercel serverless function (Node 18) — POST { number: "+628..." }
- index.html : Simple frontend
- vercel.json : Function config
- package.json : deps (https-proxy-agent)

Environment variables (set in Vercel):
- PROXIES (optional): newline-separated proxy URLs to route requests through.
- RATE_LIMIT_PER_MIN (optional): default 30
- EXPOSE_RAW (optional): set to "1" to include raw WhatsApp response in API output (for debugging)
- MAX_RETRIES (optional): default 2

Deployment:
1. Push repo to GitHub or upload to Vercel (Import Project).
2. Add env vars in Vercel dashboard.
3. Deploy.

⚠️ Legal & operational:
This project uses unofficial WhatsApp endpoints. It may violate WhatsApp's Terms of Service. Use proxies and rate limiting and only test responsibly.
