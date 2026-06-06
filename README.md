# Order App React

## Local Setup

1. Copy `.env.example` to `.env`.
2. Fill in Woo credentials in `.env`.
3. Run `npm install`.
4. Start the backend API: `npm run server`.
5. In another terminal, start frontend: `npm run dev`.

The frontend runs on `http://localhost:5173` and proxies API calls to `http://localhost:3031`.

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
