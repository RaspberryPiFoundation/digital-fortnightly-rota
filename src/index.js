const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://digital-docs.rpf-internal.org",
];

function corsHeadersFor(request) {
  const origin = request.headers.get("Origin");
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "";

  return {
    ...(corsOrigin && { "Access-Control-Allow-Origin": corsOrigin }),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = corsHeadersFor(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const dbCheck = await env.digital_fortnightly_rota
        .prepare("SELECT 1 AS ok")
        .first();

      return jsonResponse(
        {
          ok: true,
          database: dbCheck?.ok === 1,
          service: "digital-fortnightly-rota",
        },
        { headers: corsHeaders },
      );
    }

    return jsonResponse(
      {
        error: "Not found",
      },
      { status: 404, headers: corsHeaders },
    );
  },
};
