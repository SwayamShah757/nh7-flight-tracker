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

    // If /track has no coordinates, try FlightNerve's documented /monitored
    // live-board endpoint before falling back to the watchlist metadata.
    let monitoredHttpStatus = null;
    let monitoredFlightFound = null;
    let monitoredPositionPresent = null;
    if (!position) {
      const monitoredResponse = await fetch("https://api.flightnerve.com/monitored/" + encodeURIComponent(apiKey), {
        headers: { Accept: "application/json" }
      });
      monitoredHttpStatus = monitoredResponse.status;
      if (monitoredResponse.ok) {
        const monitoredData = await monitoredResponse.json();
        const flights = Array.isArray(monitoredData?.flights) ? monitoredData.flights : [];
        const monitoredFlight = flights.find(f =>
          String(f?.flight || "").replace(/\\s/g, "").toUpperCase() === "NH7" &&
          (!dateCompact || !f?.day || String(f.day) === dateCompact)
        ) || flights.find(f => String(f?.flight || "").replace(/\\s/g, "").toUpperCase() === "NH7");
        monitoredFlightFound = Boolean(monitoredFlight);
        const p = monitoredFlight?.position;
        monitoredPositionPresent = Boolean(p && p.latitude != null && p.longitude != null);
        if (p && p.latitude != null && p.longitude != null &&
            Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)) &&
            Number(p.latitude) >= -90 && Number(p.latitude) <= 90 &&
            Number(p.longitude) >= -180 && Number(p.longitude) <= 180) {
          position = {
            latitude: p.latitude,
            longitude: p.longitude,
            altitude: p.altitude ?? null,
            groundSpeed: p.groundSpeed ?? null,
            source: p.source || null,
            updatedAgo: p.updatedAgo || p.lastUpdated || null
          };
          trackingResponseType = "monitored-position";
        }
      }
    }

    // FlightNerve documents the /watch endpoint for a user's tracked-flight list.
    // Check that documented endpoint if /track returns no position.
    let watchHttpStatus = null;
    let watchTrackedCount = null;
    let watchHasNH7 = null;
    let watchFlightKeys = [];
    let watchLiveKeys = [];
    let watchPositionKeys = [];
    let watchLatitudePresent = null;
    let watchLongitudePresent = null;
    let watchPositionStale = null;
    let watchPhase = null;
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
        watchLatitudePresent = lat != null && lat !== "";
        watchLongitudePresent = lon != null && lon !== "";
        watchPositionStale = p?.pos_stale ?? null;
        watchPhase = p?.phase ?? null;
        if (lat != null && lat !== "" && lon != null && lon !== "" &&
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

    // Last live-data fallback: query the public ADS-B feed by ANA's likely
    // radio callsign. Accept only fresh, valid coordinates; never infer a live fix.
    let adsbHttpStatus = null;
    if (!position) {
      try {
        const adsbResponse = await fetch("https://api.adsb.lol/v2/callsign/ANA7", {
          headers: { Accept: "application/json" }
        });
        adsbHttpStatus = adsbResponse.status;
        if (adsbResponse.ok) {
          const adsbData = await adsbResponse.json();
          const aircraftList = Array.isArray(adsbData?.ac) ? adsbData.ac : [];
          const aircraftFix = aircraftList.find(a =>
            a && a.lat != null && a.lon != null &&
            Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)) &&
            Number(a.lat) >= -90 && Number(a.lat) <= 90 &&
            Number(a.lon) >= -180 && Number(a.lon) <= 180 &&
            Number.isFinite(Number(a.seen_pos)) && Number(a.seen_pos) <= 120
          );
          if (aircraftFix) {
            position = {
              latitude: aircraftFix.lat,
              longitude: aircraftFix.lon,
              altitude: aircraftFix.alt_baro === "ground" ? null : (aircraftFix.alt_baro ?? aircraftFix.alt_geom ?? null),
              groundSpeed: aircraftFix.gs ?? null,
              source: "adsb.lol ADS-B",
              updatedAgo: Number(aircraftFix.seen_pos) < 5
                ? "just now"
                : Math.round(Number(aircraftFix.seen_pos)) + " sec ago"
            };
            trackingResponseType = "adsb-live-position";
          }
        }
      } catch (_) {
        // Keep schedule/status working if the secondary live feed is unavailable.
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
      adsbHttpStatus,
      monitoredHttpStatus,
      monitoredFlightFound,
      monitoredPositionPresent,
      watchHttpStatus,
      watchTrackedCount,
      watchHasNH7,
      watchFlightKeys,
      watchLiveKeys,
      watchPositionKeys,
      watchLatitudePresent,
      watchLongitudePresent,
      watchPositionStale,
      watchPhase,
      message: position
        ? `Position source: ${position.source || "provider"}; last update ${position.updatedAgo || "time unavailable"}.`
        : `Flight schedule/status loaded; /track HTTP ${trackingHttpStatus}, response: ${trackingResponseType}; /monitored HTTP ${monitoredHttpStatus}; /watch HTTP ${watchHttpStatus}; ADS-B fallback HTTP ${adsbHttpStatus}. No usable live aircraft coordinates were returned.`
    });
  } catch (error) {
    return res.status(502).json({ error: "Could not contact FlightNerve. Try again shortly." });
  }
}
