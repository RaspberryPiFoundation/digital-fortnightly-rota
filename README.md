# Digital Fortnightly Rota

A small Cloudflare Worker API for the Digital Fortnightly self-serve speaker rota.

This follows the same lightweight Worker shape as `worker-comments`, using D1 for shared rota data.

## Set up

```bash
npm install
```

## Development

```bash
npm run dev
```

The API exposes:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Checks the Worker and D1 binding. |
| `GET` | `/events` | Returns the next generated Digital Fortnightly events with talks and remaining capacity. |
| `PATCH` | `/events/:date/theme` | Updates an event theme. |
| `POST` | `/events/:date/talks` | Adds a talk if the event has enough remaining capacity. |
| `DELETE` | `/talks/:id` | Deletes a talk. |

Example talk request:

```bash
curl -X POST "http://localhost:8787/events/2026-08-19/talks" \
  -H "Content-Type: application/json" \
  -d '{
    "speakerName": "Ada Lovelace",
    "speakerEmail": "ada@example.com",
    "title": "A tiny demo",
    "durationMinutes": 10
  }'
```

Example theme request:

```bash
curl -X PATCH "http://localhost:8787/events/2026-08-19/theme" \
  -H "Content-Type: application/json" \
  -d '{ "theme": "Show the thing" }'
```

## Deployment

```bash
npm run deploy
```

The Worker is configured for:

```text
digital-fortnightly-rota.digital-docs.rpf-internal.org
```

## Rules

- Events are generated every other Wednesday.
- Each event has 30 minutes of capacity.
- Talks can be 5, 10, 15, 20 or 30 minutes long.
- Talk creation is rejected if it would exceed the remaining event capacity.
- Cloudflare Access will be used as the staff-only gate. Any authenticated RPF user can edit the rota.
