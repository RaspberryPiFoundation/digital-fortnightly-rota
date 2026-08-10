# Digital Fortnightly Rota

A small Cloudflare Worker API for the Digital Fortnightly self-serve speaker rota.

This follows the same lightweight Worker shape as `worker-comments`, but will use D1 for shared rota data once the database step is implemented.

## Set up

```bash
npm install
```

## Development

```bash
npm run dev
```

The initial scaffold exposes:

```text
GET /health
```

## Deployment

```bash
npm run deploy
```

The Worker is configured for:

```text
digital-fortnightly-rota.digital-docs.rpf-internal.org
```

## Planned API

- `GET /events`
- `PATCH /events/:date/theme`
- `POST /events/:date/talks`
- `DELETE /talks/:id`

Cloudflare Access will be used as the staff-only gate. Any authenticated RPF user can edit the rota.
