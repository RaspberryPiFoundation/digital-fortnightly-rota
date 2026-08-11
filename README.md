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
| `PATCH` | `/events/:date/date` | Updates the display date for an event while keeping the generated date as its stable ID. |
| `PATCH` | `/events/:date/theme` | Updates an event theme. |
| `PATCH` | `/events/:date/cancel` | Cancels an event so it is hidden from the default event list. |
| `PATCH` | `/events/:date/restore` | Restores a cancelled event. |
| `POST` | `/events/:date/talks` | Adds a talk if the event has enough remaining capacity. |
| `DELETE` | `/talks/:id` | Deletes a talk. |

Example talk request:

```bash
curl -X POST "http://localhost:8787/events/2026-08-19/talks" \
  -H "Content-Type: application/json" \
  -d '{
    "speakerName": "Ada Lovelace",
    "speakerPersonKey": "ada-lovelace",
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

Example date request:

```bash
curl -X PATCH "http://localhost:8787/events/2026-09-02/date" \
  -H "Content-Type: application/json" \
  -d '{ "displayDate": "2026-09-09" }'
```

Example cancellation request:

```bash
curl -X PATCH "http://localhost:8787/events/2026-09-02/cancel" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Skipped this fortnight" }'
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
- Event dates can be overridden without changing the stable generated date used by talks.
- Events can be cancelled and restored.
- Each event has 30 minutes of capacity.
- Talks can be 5, 10, 15, 20 or 30 minutes long.
- Talks can optionally store a `speakerPersonKey` so the documentation site can match speakers to known people and show their avatar/profile link.
- Talk creation is rejected if it would exceed the remaining event capacity.
- Cloudflare Access will be used as the staff-only gate. Any authenticated RPF user can edit the rota.
