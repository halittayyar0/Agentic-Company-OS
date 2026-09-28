# Phone access without a separate app

Agentic Company OS is a responsive web application. The phone uses its normal browser; there is no iOS or Android application to build or maintain. Keep the API and UI on **one origin** so the operator session cookie and `/api` requests work together.

## Recommended private route: Tailscale Serve

For a personal, non-commercial installation, Tailscale's current Personal plan offers a free tier. Tailscale Serve gives the existing local web server an HTTPS address reachable only by devices in the same tailnet. The phone needs the ordinary Tailscale network client, but no AgenticOS phone app. This route does not require buying a domain or opening a router port. Check the current [pricing and Personal-plan terms](https://tailscale.com/pricing) before relying on the free tier for another use case.

For maintainers operating an OSI-licensed project through a GitHub organization, Tailscale also documents a free [Community on GitHub plan](https://tailscale.com/docs/reference/free-plans-discounts). It requires GitHub authentication and contacting Tailscale Support; it is not automatically granted merely because this repository is public. The self-managed route below remains available without a Tailscale plan.

1. Install Agentic Company OS in production mode with PostgreSQL, the 32+ character operator access key, and the built static UI. The default `compose.yaml` already publishes only `127.0.0.1:5000` on the host and requires the access key. Do not use the in-memory PGlite development process for a remotely accessible installation.
2. Install and sign in to Tailscale on the computer/server and the phone using the same private tailnet. Enable MagicDNS and HTTPS certificates in the tailnet if prompted. Find the computer's actual `device.tailnet.ts.net` name; do not copy the example below.
3. In the root `.env` used by Docker Compose, set the exact hostname and origin:

   ```dotenv
   TRUSTED_HOSTS=device.tailnet.ts.net
   CORS_ALLOWED_ORIGINS=https://device.tailnet.ts.net
   ```

   `TRUSTED_HOSTS` takes the hostname only; `CORS_ALLOWED_ORIGINS` takes the full HTTPS origin. Keep these values limited to the one chosen hostname. Restart the API container so it reads the new values (`docker compose up -d --force-recreate app`). For a non-Compose install, set the same environment variables before starting the production API with `HOST=127.0.0.1`, `SERVE_STATIC_UI=true`, and a durable `DATABASE_URL`.

4. On the host, run `tailscale serve --bg 5000`. Record the exact HTTPS URL printed by Serve and verify it with `tailscale serve status`. The `--bg` mode persists across host restarts. This must be **Serve**, not Funnel: Funnel would make the site public.
5. On the phone, connect Tailscale and open the printed HTTPS URL in Safari, Chrome, or another browser. Sign in with the AgenticOS operator access key. Test Home, Projects, Operations, and Settings, then test again over mobile data with Wi-Fi disabled.

The host computer and AgenticOS server must be running for the phone to connect. Tailnet membership is a network gate; the AgenticOS operator key remains required. Do not share the key in a URL, screenshot, or QR code. To revoke the browser route, run `tailscale serve off`. To revoke one phone, remove that device from the tailnet. Keep Tailscale's access rules restricted to the intended operator.

## Fully self-managed route

If Tailscale's Personal terms do not fit your use, run an existing WireGuard VPN under your own control, connect the phone with a standard WireGuard client, and put an HTTPS reverse proxy in front of the local AgenticOS origin. The application needs no code changes. Configure its `TRUSTED_HOSTS` and `CORS_ALLOWED_ORIGINS` for the exact HTTPS hostname and keep the API port inaccessible from the public internet. WireGuard is open source and has no software subscription, but network reachability, DNS/TLS, backups, and the host's power/internet remain your responsibility. This route may require router configuration or an already available server.

## Verification limits

The repository can test mobile viewport layout, HTTPS-origin security rules, and authenticated API flows. A real phone connection depends on the installer's network, tailnet or VPN account, DNS, and TLS state; it must be checked on the installed system. The app intentionally does not discover a private hostname or silently expose a public port.
