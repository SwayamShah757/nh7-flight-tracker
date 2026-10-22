// Vercel serverless function. Keep AEROAPI_KEY in Vercel Project Settings > Environment Variables.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });
  const apiKey = process.env.AEROAPI_KEY;
  if (!apiKey) return res.status(503).json({ error: "Backend is not configured yet: add AEROAPI_KEY to the server environment." });

  const flight = String(req.query.flight || "NH7").toUpperCase();
  const date = String(req.query.date || "");
  if (!/^[A-Z0-9]{2,8}$/.test(flight)) return res.status(400).json({ error: "Invalid flight designator." });
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Date must be YYYY-MM-DD." });

  try {
    const upstream = await fetch(`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(flight)}?max_pages=1`, {
      headers: { "x-apikey": apiKey, "Accept": "application/json" }
    });
    if (!upstream.ok) {
      const safeStatus = upstream.status;
      return res.status(safeStatus === 401 || safeStatus === 403 ? 502 : safeStatus).json({
        error: `Flight data provider returned HTTP ${safeStatus}. Check API access, quota, and flight coverage.`
      });
    }
    const payload = await upstream.json();
    const flights = Array.isArray(payload.flights) ? payload.flights : [];
    const matches = flights.filter(f => {
      const origin = String(f.origin?.code_iata || f.origin?.code || "").toUpperCase();
      const dest = String(f.destination?.code_iata || f.destination?.code || "").toUpperCase();
      const scheduled = String(f.scheduled_out || f.scheduled_departure || "");
      const sameRoute = (!origin || origin === "SFO" || origin === "KSFO") && (!dest || dest === "NRT" || dest === "RJAA");
      const sameDate = !date || !scheduled || scheduled.slice(0, 10) === date;
      return sameRoute && sameDate;
    });
    const f = matches[0] || flights[0];
    if (!f) return res.status(404).json({ error: "No matching NH7 record was returned. Try the departure date or check again later." });

    // AeroAPI flight objects can include last_position; field availability depends on endpoint/data coverage.
    const p = f.last_position || f.position || {};
    return res.status(200).json({
      flight: f.ident || flight,
      status: f.status || f.progress_percent != null && "En route" || "Status unavailable",
      scheduledArrival: f.scheduled_in || f.scheduled_arrival || null,
      estimatedArrival: f.estimated_in || f.estimated_arrival || null,
      latitude: Number.isFinite(Number(p.latitude)) && p.latitude !== undefined ? Number(p.latitude) : null,
      longitude: Number.isFinite(Number(p.longitude)) && p.longitude !== undefined ? Number(p.longitude) : null,
      altitudeFeet: p.altitude != null ? Number(p.altitude) : null,
      groundspeedKnots: p.groundspeed != null ? Number(p.groundspeed) : null,
      message: f.status ? `Provider status: ${f.status}. Times are shown in UTC.` : "Flight record found; some fields may not be available."
    });
  } catch (err) {
    return res.status(502).json({ error: "Could not contact the flight data provider. Try again shortly." });
  }
}
