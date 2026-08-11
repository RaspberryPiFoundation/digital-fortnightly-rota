const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://digital-docs.rpf-internal.org",
];

const CAPACITY_MINUTES = 30;
const EVENT_COUNT = 8;
const EVENT_INTERVAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE_EVENT_UTC = Date.UTC(2026, 6, 22);
const TALK_DURATIONS = [5, 10, 15, 20, 30];
const THEME_SUGGESTIONS = [
  "Show the thing: demos, prototypes and experiments",
  "How we work: habits, tools and tiny improvements",
  "Users, inclusion and access",
  "Engineering stories and technical deep dives",
  "Learning out loud",
  "Open lightning talks",
];

function corsHeadersFor(request) {
  const origin = request.headers.get("Origin");
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "";

  return {
    ...(corsOrigin && { "Access-Control-Allow-Origin": corsOrigin }),
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...(corsOrigin && { "Access-Control-Allow-Credentials": "true" }),
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

function errorResponse(message, { status = 400, headers = {} } = {}) {
  return jsonResponse({ error: message }, { status, headers });
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getStartOfUtcDay(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function isValidEventDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function getUpcomingEvents(now = new Date()) {
  const todayUtc = getStartOfUtcDay(now);
  const elapsedIntervals = Math.max(
    0,
    Math.ceil((todayUtc - REFERENCE_EVENT_UTC) / (EVENT_INTERVAL_DAYS * DAY_MS)),
  );
  const firstEventUtc =
    REFERENCE_EVENT_UTC + elapsedIntervals * EVENT_INTERVAL_DAYS * DAY_MS;

  return Array.from({ length: EVENT_COUNT }, (_, index) => {
    const eventDate = new Date(
      firstEventUtc + index * EVENT_INTERVAL_DAYS * DAY_MS,
    );
    const date = eventDate.toISOString().slice(0, 10);

    return {
      date,
      theme: THEME_SUGGESTIONS[index % THEME_SUGGESTIONS.length],
      capacityMinutes: CAPACITY_MINUTES,
    };
  });
}

async function ensureUpcomingEvents(db) {
  const statements = getUpcomingEvents().map((event) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO events (date, theme, capacity_minutes)
         VALUES (?, ?, ?)`,
      )
      .bind(event.date, event.theme, event.capacityMinutes),
  );

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

async function ensureEvent(db, date, theme = "") {
  await db
    .prepare(
      `INSERT OR IGNORE INTO events (date, theme, capacity_minutes)
       VALUES (?, ?, ?)`,
    )
    .bind(date, theme, CAPACITY_MINUTES)
    .run();
}

function eventFromRow(row) {
  return {
    date: row.date,
    theme: row.theme,
    capacityMinutes: row.capacity_minutes,
    bookedMinutes: row.booked_minutes || 0,
    remainingMinutes: row.capacity_minutes - (row.booked_minutes || 0),
    talks: [],
  };
}

function talkFromRow(row) {
  return {
    id: row.id,
    eventDate: row.event_date,
    speakerName: row.speaker_name,
    speakerEmail: row.speaker_email,
    title: row.title,
    durationMinutes: row.duration_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listEvents(db) {
  await ensureUpcomingEvents(db);

  const dates = getUpcomingEvents().map((event) => event.date);
  const placeholders = dates.map(() => "?").join(", ");

  const eventsResult = await db
    .prepare(
      `SELECT
        events.date,
        events.theme,
        events.capacity_minutes,
        COALESCE(SUM(talks.duration_minutes), 0) AS booked_minutes
       FROM events
       LEFT JOIN talks ON talks.event_date = events.date
       WHERE events.date IN (${placeholders})
       GROUP BY events.date, events.theme, events.capacity_minutes
       ORDER BY events.date ASC`,
    )
    .bind(...dates)
    .all();

  const talksResult = await db
    .prepare(
      `SELECT
        id,
        event_date,
        speaker_name,
        speaker_email,
        title,
        duration_minutes,
        created_at,
        updated_at
       FROM talks
       WHERE event_date IN (${placeholders})
       ORDER BY created_at ASC`,
    )
    .bind(...dates)
    .all();

  const events = eventsResult.results.map(eventFromRow);
  const eventByDate = new Map(events.map((event) => [event.date, event]));

  talksResult.results.forEach((row) => {
    const event = eventByDate.get(row.event_date);
    if (event) {
      event.talks.push(talkFromRow(row));
    }
  });

  return events;
}

function cleanString(value) {
  return String(value || "").trim();
}

function validateTalkInput(body) {
  const speakerName = cleanString(body?.speakerName);
  const speakerEmail = cleanString(body?.speakerEmail);
  const title = cleanString(body?.title);
  const durationMinutes = Number(body?.durationMinutes);

  if (!speakerName || !title) {
    return { error: "speakerName and title are required" };
  }

  if (!TALK_DURATIONS.includes(durationMinutes)) {
    return { error: "durationMinutes must be one of 5, 10, 15, 20 or 30" };
  }

  return {
    talk: {
      speakerName,
      speakerEmail,
      title,
      durationMinutes,
    },
  };
}

async function createTalk(db, date, body) {
  if (!isValidEventDate(date)) {
    return { error: "Invalid event date", status: 400 };
  }

  const validation = validateTalkInput(body);
  if (validation.error) {
    return { error: validation.error, status: 400 };
  }

  await ensureEvent(db, date);

  const talk = validation.talk;
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT INTO talks (
        id,
        event_date,
        speaker_name,
        speaker_email,
        title,
        duration_minutes
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE ? <= (
        SELECT events.capacity_minutes - COALESCE(SUM(talks.duration_minutes), 0)
        FROM events
        LEFT JOIN talks ON talks.event_date = events.date
        WHERE events.date = ?
        GROUP BY events.capacity_minutes
      )`,
    )
    .bind(
      id,
      date,
      talk.speakerName,
      talk.speakerEmail,
      talk.title,
      talk.durationMinutes,
      talk.durationMinutes,
      date,
    )
    .run();

  if (result.meta.changes !== 1) {
    return {
      error: "That talk would exceed the remaining capacity for this event",
      status: 409,
    };
  }

  const row = await db
    .prepare(
      `SELECT
        id,
        event_date,
        speaker_name,
        speaker_email,
        title,
        duration_minutes,
        created_at,
        updated_at
       FROM talks
       WHERE id = ?`,
    )
    .bind(id)
    .first();

  return { talk: talkFromRow(row) };
}

async function updateTheme(db, date, body) {
  if (!isValidEventDate(date)) {
    return { error: "Invalid event date", status: 400 };
  }

  const theme = cleanString(body?.theme);
  if (!theme) {
    return { error: "theme is required", status: 400 };
  }

  await ensureEvent(db, date, theme);

  const result = await db
    .prepare(
      `UPDATE events
       SET theme = ?, updated_at = CURRENT_TIMESTAMP
       WHERE date = ?`,
    )
    .bind(theme, date)
    .run();

  if (result.meta.changes !== 1) {
    return { error: "Event not found", status: 404 };
  }

  const event = await db
    .prepare(
      `SELECT
        events.date,
        events.theme,
        events.capacity_minutes,
        COALESCE(SUM(talks.duration_minutes), 0) AS booked_minutes
       FROM events
       LEFT JOIN talks ON talks.event_date = events.date
       WHERE events.date = ?
       GROUP BY events.date, events.theme, events.capacity_minutes`,
    )
    .bind(date)
    .first();

  return { event: eventFromRow(event) };
}

async function deleteTalk(db, id) {
  if (!id) {
    return { error: "Talk id is required", status: 400 };
  }

  const result = await db
    .prepare("DELETE FROM talks WHERE id = ?")
    .bind(id)
    .run();

  if (result.meta.changes !== 1) {
    return { error: "Talk not found", status: 404 };
  }

  return { deleted: true };
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const db = env.digital_fortnightly_rota;

  if (request.method === "GET" && url.pathname === "/health") {
    const dbCheck = await db.prepare("SELECT 1 AS ok").first();

    return {
      ok: true,
      database: dbCheck?.ok === 1,
      service: "digital-fortnightly-rota",
    };
  }

  if (request.method === "GET" && url.pathname === "/events") {
    return { events: await listEvents(db) };
  }

  const themeMatch = url.pathname.match(/^\/events\/(\d{4}-\d{2}-\d{2})\/theme$/);
  if (request.method === "PATCH" && themeMatch) {
    const body = await parseJson(request);
    if (!body) {
      return { error: "Invalid JSON", status: 400 };
    }

    return updateTheme(db, themeMatch[1], body);
  }

  const talksMatch = url.pathname.match(/^\/events\/(\d{4}-\d{2}-\d{2})\/talks$/);
  if (request.method === "POST" && talksMatch) {
    const body = await parseJson(request);
    if (!body) {
      return { error: "Invalid JSON", status: 400 };
    }

    return createTalk(db, talksMatch[1], body);
  }

  const deleteTalkMatch = url.pathname.match(/^\/talks\/([^/]+)$/);
  if (request.method === "DELETE" && deleteTalkMatch) {
    return deleteTalk(db, decodeURIComponent(deleteTalkMatch[1]));
  }

  return { error: "Not found", status: 404 };
}

export default {
  async fetch(request, env) {
    const corsHeaders = corsHeadersFor(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const result = await handleRequest(request, env);

      if (result.error) {
        return errorResponse(result.error, {
          status: result.status || 400,
          headers: corsHeaders,
        });
      }

      return jsonResponse(result, { headers: corsHeaders });
    } catch (error) {
      return errorResponse("Internal server error", {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
