// Vercel serverless function. Keep FLIGHTNERVE_API_KEY in Vercel Project Settings > Environment Variables.
const ALLOWED_ORIGIN = "https://swayamshah757.github.io";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });

  const apiKey = process.env.FLIGHTNERVE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Backend is not configured yet: add FLIGHTNERVE_API_KEY in Vercel environment variables." });

  const date = String(req.query.date || "");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Date must be YYYY-MM-DD." });
  }

  const dateCompact = date ? date.replace(/-/g, "") : "";

  try {
    const query = new URLSearchParams({ num: "7", name: "NH", depap: "SFO", arrap: "NRT" });
    if (dateCompact) query.set("date", dateCompact);

    const statusResponse = await fetch(`https://api.flightnerve.com/airline/${encodeURIComponent(apiKey)}?${query.toString()}`, {
      headers: { Accept: "application/json" }
    });
    if (!statusResponse.ok) {
      const providerStatus = statusResponse.status;
      return res.status(providerStatus === 401 || providerStatus === 403 ? 502 : providerStatus).json({
        error: `FlightNerve returned HTTP ${providerStatus}. Check the API key, credits, and flight/date coverage.`
      });
    }

    const raw = await statusResponse.json();
    const leg = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw;
    if (!Array.isArray(leg) || leg.length < 4) {
      return res.status(502).json({ error: "FlightNerve returned an unexpected response format." });
    }

    const departure = leg.find(item => item && item.departure)?.departure || {};
    const arrival = leg.find(item => item && item.arrival)?.arrival || {};
    const aircraft = leg.find(item => item && item.aircraft)?.aircraft || {};
    const statusObject = leg.find(item => item && item.status)?.status;
    const status = typeof statusObject === "string" ? statusObject : statusObject?.status || "Status unavailable";

    let position = null;
    let trackingHttpStatus = null;
    let trackingResponseType = "unknown";

    // FlightNerve's /track docs say only today's date can be airborne.
    // When a date is supplied to our frontend, use it for schedule lookup,
    // but omit date from live tracking so the provider resolves its active instance.
    const trackQuery = new URLSearchParams({ num: "7", name: "NH" });
    const positionResponse = await fetch("https://api.flightnerve.com/track/" + encodeURIComponent(apiKey) + "?" + trackQuery.toString(), {
      headers: { Accept: "application/json" }
    });
    trackingHttpStatus = positionResponse.status;
    if (positionResponse.ok) {
      const positions = await positionResponse.json();
      trackingResponseType = Array.isArray(positions) ? (positions.length ? "array-with-results" : "empty-array") : typeof positions;
      const candidates = Array.isArray(positions) ? positions : [];
      position = candidates.find(p => p && p.latitude != null && p.longitude != null &&
        Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))) || null;
    }

    // FlightNerve documents the /watch endpoint for a user's tracked-flight list.
    // Check that documented endpoint if /track returns no position.
    let watchHttpStatus = null;
    let watchTrackedCount = null;
    let watchHasNH7 = null;
    let watchFlightKeys = [];
    let watchLiveKeys = [];
    let watchPositionKeys = [];
    if (!position) {
      const watchResponse = await fetch("https://api.flightnerve.com/watch/" + encodeURIComponent(apiKey), {
        headers: { Accept: "application/json" }
      });
      watchHttpStatus = watchResponse.status;
      if (watchResponse.ok) {
        const watchData = await watchResponse.json();
        const tracked = Array.isArray(watchData?.tracked) ? watchData.tracked : [];
        watchTrackedCount = tracked.length;
        const watchedFlight = tracked.find(f =>
          String(f?.flight || "").replace(/\s/g, "").toUpperCase() === "NH7" &&
          (!dateCompact || !f?.day || String(f.day) === dateCompact)
        ) || tracked.find(f => String(f?.flight || "").replace(/\s/g, "").toUpperCase() === "NH7");
        watchHasNH7 = Boolean(watchedFlight);
        if (watchedFlight && typeof watchedFlight === "object") {
          watchFlightKeys = Object.keys(watchedFlight).slice(0, 30);
          if (watchedFlight.live && typeof watchedFlight.live === "object") {
            watchLiveKeys = Object.keys(watchedFlight.live).slice(0, 30);
          }
        }
        // /watch's documented live object exposes coordinates as live.lat/live.lon,
        // not necessarily as a nested live.position object.
        const p = watchedFlight?.position || watchedFlight?.live?.position || watchedFlight?.live;
        if (p && typeof p === "object") watchPositionKeys = Object.keys(p).slice(0, 30);
        const lat = p?.latitude ?? p?.lat;
        const lon = p?.longitude ?? p?.lon;
        if (lat != null && lon != null &&
            Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) &&
            Number(lat) >= -90 && Number(lat) <= 90 &&
            Number(lon) >= -180 && Number(lon) <= 180) {
          position = {
            latitude: lat,
            longitude: lon,
            altitude: p.altitude ?? p.alt_ft,
            groundSpeed: p.groundSpeed ?? p.gs_kt,
            source: p.source || p.pos_source || watchedFlight?.fn_source,
            updatedAgo: p.updatedAgo || p.lastUpdated || p.last_seen || null
          };
          trackingResponseType = "watch-position";
        }
      }
    }

    return res.status(200).json({
      flight: "NH7",
      status,
      scheduledDeparture: departure.departureDateTimeUtc || null,
      estimatedDeparture: departure.estimatedTimeUtc || null,
      scheduledArrival: arrival.arrivalDateTimeUtc || null,
      estimatedArrival: arrival.arrivalDateTimeUtc && arrival.estimatedTimeUtc
        ? arrival.arrivalDateTimeUtc.replace(/T[^T]*$/, "T" + arrival.estimatedTimeUtc)
        : arrival.estimatedTimeUtc || arrival.arrivalDateTimeUtc || null,
      departureLocal: departure.scheduledTime || null,
      estimatedDepartureLocal: departure.estimatedTime || null,
      arrivalLocal: arrival.scheduledTime || null,
      estimatedArrivalLocal: arrival.estimatedTime || null,
      aircraft: aircraft.name || aircraft.code || null,
      latitude: position ? Number(position.latitude) : null,
      longitude: position ? Number(position.longitude) : null,
      altitudeFeet: position?.altitude != null ? Number(position.altitude) : null,
      groundspeedKnots: position?.groundSpeed != null ? Number(position.groundSpeed) : null,
      positionSource: position?.source || null,
      positionUpdatedAgo: position?.updatedAgo || null,
      trackingHttpStatus,
      trackingResponseType,
      watchHttpStatus,
      watchTrackedCount,
      watchHasNH7,
      watchFlightKeys,
      watchLiveKeys,
      watchPositionKeys,
      message: position
        ? `Position source: ${position.source || "provider"}; last update ${position.updatedAgo || "time unavailable"}.`
        : `Flight schedule/status loaded; /track HTTP ${trackingHttpStatus}, response: ${trackingResponseType}; /watch HTTP ${watchHttpStatus}. No usable aircraft coordinates were returned.`
    });
  } catch (error) {
    return res.status(502).json({ error: "Could not contact FlightNerve. Try again shortly." });
  }
}
