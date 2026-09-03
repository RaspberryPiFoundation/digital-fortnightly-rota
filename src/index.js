const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://digital-docs.rpf-internal.org",
];

const CAPACITY_MINUTES = 30;
const EVENT_COUNT = 8;
const PAST_EVENT_LIMIT = 100;
const EVENT_INTERVAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE_EVENT_UTC = Date.UTC(2026, 8, 2);
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
    displayDate: row.display_date || row.date,
    theme: row.theme,
    capacityMinutes: row.capacity_minutes,
    bookedMinutes: row.booked_minutes || 0,
    remainingMinutes: row.capacity_minutes - (row.booked_minutes || 0),
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    talks: [],
  };
}

function talkFromRow(row) {
  return {
    id: row.id,
    eventDate: row.event_date,
    speakerName: row.speaker_name,
    speakerPersonKey: row.speaker_person_key,
    title: row.title,
    durationMinutes: row.duration_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listEvents(db) {
  await ensureUpcomingEvents(db);

  const upcomingEvents = getUpcomingEvents();
  const dates = upcomingEvents.map((event) => event.date);
  const firstDisplayDate = dates[0];
  const placeholders = dates.map(() => "?").join(", ");

  const eventsResult = await db
    .prepare(
      `SELECT
        events.date,
        events.display_date,
        events.theme,
        events.capacity_minutes,
        events.cancelled_at,
        events.cancellation_reason,
        COALESCE(SUM(talks.duration_minutes), 0) AS booked_minutes
       FROM events
       LEFT JOIN talks ON talks.event_date = events.date
       WHERE (
          events.date IN (${placeholders})
          OR COALESCE(events.display_date, events.date) >= ?
        )
        AND events.cancelled_at IS NULL
       GROUP BY
        events.date,
        events.display_date,
        events.theme,
        events.capacity_minutes,
        events.cancelled_at,
        events.cancellation_reason
       ORDER BY COALESCE(events.display_date, events.date) ASC
       LIMIT ${EVENT_COUNT}`,
    )
    .bind(...dates, firstDisplayDate)
    .all();

  const events = eventsResult.results.map(eventFromRow);
  const eventByDate = new Map(events.map((event) => [event.date, event]));
  const visibleDates = events.map((event) => event.date);

  if (visibleDates.length === 0) {
    return events;
  }

  const visiblePlaceholders = visibleDates.map(() => "?").join(", ");
  const talksResult = await db
    .prepare(
      `SELECT
        id,
        event_date,
        speaker_name,
        speaker_person_key,
        title,
        duration_minutes,
        created_at,
        updated_at
       FROM talks
       WHERE event_date IN (${visiblePlaceholders})
       ORDER BY created_at ASC`,
    )
    .bind(...visibleDates)
    .all();

  talksResult.results.forEach((row) => {
    const event = eventByDate.get(row.event_date);
    if (event) {
      event.talks.push(talkFromRow(row));
    }
  });

  return events;
}

async function listPastEvents(db, limit = PAST_EVENT_LIMIT) {
  const today = new Date().toISOString().slice(0, 10);

  // INNER JOIN so sessions that never had a talk are left out.
  const eventsResult = await db
    .prepare(
      `SELECT
        events.date,
        events.display_date,
        events.theme,
        events.capacity_minutes,
        events.cancelled_at,
        events.cancellation_reason,
        COALESCE(SUM(talks.duration_minutes), 0) AS booked_minutes
       FROM events
       INNER JOIN talks ON talks.event_date = events.date
       WHERE COALESCE(events.display_date, events.date) < ?
         AND events.cancelled_at IS NULL
       GROUP BY
        events.date,
        events.display_date,
        events.theme,
        events.capacity_minutes,
        events.cancelled_at,
        events.cancellation_reason
       ORDER BY COALESCE(events.display_date, events.date) DESC
       LIMIT ?`,
    )
    .bind(today, limit)
    .all();

  const events = eventsResult.results.map(eventFromRow);
  const eventByDate = new Map(events.map((event) => [event.date, event]));
  const dates = events.map((event) => event.date);

  if (dates.length === 0) {
    return events;
  }

  const placeholders = dates.map(() => "?").join(", ");
  const talksResult = await db
    .prepare(
      `SELECT
        id,
        event_date,
        speaker_name,
        speaker_person_key,
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
  const speakerPersonKey = cleanString(body?.speakerPersonKey);
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
      speakerPersonKey,
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
        speaker_person_key,
        title,
        duration_minutes
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE ? <= (
        SELECT events.capacity_minutes - COALESCE(SUM(talks.duration_minutes), 0)
        FROM events
        LEFT JOIN talks ON talks.event_date = events.date
        WHERE events.date = ?
          AND events.cancelled_at IS NULL
        GROUP BY events.capacity_minutes
      )`,
    )
    .bind(
      id,
      date,
      talk.speakerName,
      talk.speakerPersonKey || null,
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
        speaker_person_key,
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
        events.display_date,
        events.theme,
        events.capacity_minutes,
        events.cancelled_at,
        events.cancellation_reason,
        COALESCE(SUM(talks.duration_minutes), 0) AS booked_minutes
       FROM events
       LEFT JOIN talks ON talks.event_date = events.date
       WHERE events.date = ?
       GROUP BY
        events.date,
        events.display_date,
        events.theme,
        events.capacity_minutes,
        events.cancelled_at,
        events.cancellation_reason`,
    )
    .bind(date)
    .first();

  return { event: eventFromRow(event) };
}

async function updateDisplayDate(db, date, body) {
  if (!isValidEventDate(date)) {
    return { error: "Invalid event date", status: 400 };
  }

  const displayDate = cleanString(body?.displayDate);
  if (!isValidEventDate(displayDate)) {
    return { error: "displayDate must use YYYY-MM-DD", status: 400 };
  }

  await ensureEvent(db, date);

  const result = await db
    .prepare(
      `UPDATE events
       SET display_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE date = ?`,
    )
    .bind(displayDate === date ? null : displayDate, date)
    .run();

  if (result.meta.changes !== 1) {
    return { error: "Event not found", status: 404 };
  }

  return { event: await getEvent(db, date) };
}

async function cancelEvent(db, date, body) {
  if (!isValidEventDate(date)) {
    return { error: "Invalid event date", status: 400 };
  }

  await ensureEvent(db, date);

  const reason = cleanString(body?.reason);
  const result = await db
    .prepare(
      `UPDATE events
       SET
        cancelled_at = CURRENT_TIMESTAMP,
        cancellation_reason = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE date = ?`,
    )
    .bind(reason || null, date)
    .run();

  if (result.meta.changes !== 1) {
    return { error: "Event not found", status: 404 };
  }

  return { event: await getEvent(db, date) };
}

async function restoreEvent(db, date) {
  if (!isValidEventDate(date)) {
    return { error: "Invalid event date", status: 400 };
  }

  await ensureEvent(db, date);

  const result = await db
    .prepare(
      `UPDATE events
       SET
        cancelled_at = NULL,
        cancellation_reason = NULL,
        updated_at = CURRENT_TIMESTAMP
       WHERE date = ?`,
    )
    .bind(date)
    .run();

  if (result.meta.changes !== 1) {
    return { error: "Event not found", status: 404 };
  }

  return { event: await getEvent(db, date) };
}

async function getEvent(db, date) {
  const row = await db
    .prepare(
      `SELECT
        events.date,
        events.display_date,
        events.theme,
        events.capacity_minutes,
        events.cancelled_at,
        events.cancellation_reason,
        COALESCE(SUM(talks.duration_minutes), 0) AS booked_minutes
       FROM events
       LEFT JOIN talks ON talks.event_date = events.date
       WHERE events.date = ?
       GROUP BY
        events.date,
        events.display_date,
        events.theme,
        events.capacity_minutes,
        events.cancelled_at,
        events.cancellation_reason`,
    )
    .bind(date)
    .first();

  return row ? eventFromRow(row) : null;
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

  if (request.method === "GET" && url.pathname === "/events/past") {
    return { events: await listPastEvents(db) };
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

  const dateMatch = url.pathname.match(/^\/events\/(\d{4}-\d{2}-\d{2})\/date$/);
  if (request.method === "PATCH" && dateMatch) {
    const body = await parseJson(request);
    if (!body) {
      return { error: "Invalid JSON", status: 400 };
    }

    return updateDisplayDate(db, dateMatch[1], body);
  }

  const cancelMatch = url.pathname.match(
    /^\/events\/(\d{4}-\d{2}-\d{2})\/cancel$/,
  );
  if (request.method === "PATCH" && cancelMatch) {
    const body = await parseJson(request);
    if (!body) {
      return { error: "Invalid JSON", status: 400 };
    }

    return cancelEvent(db, cancelMatch[1], body);
  }

  const restoreMatch = url.pathname.match(
    /^\/events\/(\d{4}-\d{2}-\d{2})\/restore$/,
  );
  if (request.method === "PATCH" && restoreMatch) {
    return restoreEvent(db, restoreMatch[1]);
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
