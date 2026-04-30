# AccountingIQ Bridge

Tiny Node helper that lets the AccountingIQ cloud talk to a Tally Prime instance
running on the same Windows PC.

The bridge:

1. Authenticates against the cloud using a one-time pairing code the user pastes
   from the Tally Connection screen.
2. Long-polls `https://<cloud>/api/tally/bridge-poll` for jobs.
3. Each job is an XML envelope (TDL request) — the bridge POSTs it to
   `http://localhost:9000` (Tally's XML gateway) and returns the response.
4. POSTs results back to `https://<cloud>/api/tally/bridge-result`.

Only outbound HTTPS is used — no inbound port to open. The bridge refuses to
talk to a Tally gateway that is not bound to loopback.

## Distribution

For v1, ship as a self-contained Windows .exe via:

```
npm install -g pkg
pkg src/main.mjs --target node20-win-x64 --output dist/accountingiq-bridge.exe
```

The Next.js app serves the .exe at `/download/bridge`. A future iteration wraps
this in an Electron tray app so the pairing code can be entered through a small
GUI instead of the CLI.

## Files

- `src/main.mjs` — entry point: pair → loop → poll → handle.
- `src/relay.mjs` — long-poll loop and result POST.
- `src/tally.mjs` — thin HTTP client for `localhost:9000` (with UTF-16 BOM handling).
- `src/pair.mjs` — one-shot pairing CLI; persists token to `~/.accountingiq-bridge.json`.

## Usage

```
# First time: pair with the cloud
node src/pair.mjs --cloud https://accountingiq.example.com --code AB12CD

# Then run the bridge in the background
node src/main.mjs
```
