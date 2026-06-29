# Order App React

## Local Setup

1. Copy `.env.example` to `.env`.
2. Fill in Woo credentials in `.env`.
3. Run `npm install`.
4. Start the backend API: `npm run server`.
5. In another terminal, start frontend: `npm run dev`.

The frontend runs on `http://localhost:5173` and proxies API calls to `http://localhost:3031`.

## COA Grab Testing On Localhost

Use this when you want to test the full COA handoff flow locally from the Freedom Diagnostics page.

1. Start API server:
	 `npm run server`
2. Start frontend:
	 `npm run dev` (or `npm run deb`)
3. Open your app page:
	 `http://localhost:5173/#/coa-lookup`
4. Keep that tab open.
5. In a separate tab, open Freedom Diagnostics COA search and run this in DevTools Console:

```js
const API_BASE = "http://localhost:3031/api";
const codes = [...new Set((document.body.innerText.match(/Coff\d+/gi) || []))];
console.log("Found codes:", codes.length, codes);

fetch(API_BASE + "/bulk-import-coas", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ codes }),
})
	.then(r => r.json())
	.then(async data => {
		console.log("bulk-import-coas response:", data);
		if (!data.token) {
			console.log("No new codes to import.");
			return;
		}
		const relay = await fetch(API_BASE + "/import-ready", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: data.token }),
		});
		console.log("import-ready response:", await relay.json());
		console.log("Done. Local COA Lookup page should pick up the token.");
	})
	.catch(err => console.error("Import flow failed:", err));
```

Notes:
- Local server allows requests from `https://freedomdiagnosticstesting.com`.
- If you change server or Vite config, restart both local processes.

## Required Environment Variables

- `WOO_BASE_URL`
- `WOO_CONSUMER_KEY`
- `WOO_CONSUMER_SECRET`
- `WOO_ORDER_STATUSES` (optional, comma-separated; use `any` for all statuses)
- `ALLOWED_ORIGINS` (comma-separated browser origins)
- `PORT` (optional, defaults to 3031)

## Production Notes

- Keep Woo credentials only on the server. Never expose them in frontend code.
- Set `ALLOWED_ORIGINS` to your real app domains only.
- Rotate Woo keys immediately if they were shared in screenshots or chat.
- Run frontend and backend as separate services and put HTTPS in front of both.
