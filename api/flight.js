// Vercel serverless function for NH7 live position.
// This endpoint deliberately does NOT call FlightNerve or require FLIGHTNERVE_API_KEY.
// Public ADS-B data can be incomplete; never invent coordinates when no live fix exists.
const ALLOWED_ORIGIN = "https://swayamshah757.github.io";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });

  try {
    // ANA7 is the expected radio callsign for All Nippon Airways flight NH7.
    // adsb.fi's public endpoint does not use the FlightNerve token balance.
    const response = await fetch("https://opendata.adsb.fi/api/v2/callsign/ANA7", {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return res.status(200).json({
        flight: "NH7",
        status: "Live position unavailable",
        latitude: null,
        longitude: null,
        positionSource: null,
        positionUpdatedAgo: null,
        trackingHttpStatus: null,
        adsbHttpStatus: response.status,
        message: `Public ADS-B feed returned HTTP ${response.status}. No live coordinates are available right now. FlightNerve was not called.`
      });
    }

    const data = await response.json();
    const aircraft = Array.isArray(data?.ac) ? data.ac : [];
    const fix = aircraft.find(a => {
      const lat = Number(a?.lat);
      const lon = Number(a?.lon);
      const age = Number(a?.seen_pos);
      return a?.lat != null && a?.lon != null &&
        Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
        Number.isFinite(age) && age <= 120;
    });

    if (!fix) {
      return res.status(200).json({
        flight: "NH7",
        status: "Live position unavailable",
        scheduledDeparture: null,
        estimatedDeparture: null,
        scheduledArrival: null,
        estimatedArrival: null,
        departureLocal: null,
        estimatedDepartureLocal: null,
        arrivalLocal: null,
        estimatedArrivalLocal: null,
        aircraft: null,
        latitude: null,
        longitude: null,
        altitudeFeet: null,
        groundspeedKnots: null,
        positionSource: null,
        positionUpdatedAgo: null,
        trackingHttpStatus: null,
        trackingResponseType: "no-fresh-adsb-position",
        adsbHttpStatus: response.status,
        message: "The public ADS-B feed did not return a fresh position for ANA7. No estimated coordinates are being shown as live data. FlightNerve was not called."
      });
    }

    const age = Math.max(0, Math.round(Number(fix.seen_pos)));
    return res.status(200).json({
      flight: "NH7",
      status: "Live position found",
      scheduledDeparture: null,
      estimatedDeparture: null,
      scheduledArrival: null,
      estimatedArrival: null,
      departureLocal: null,
      estimatedDepartureLocal: null,
      arrivalLocal: null,
      estimatedArrivalLocal: null,
      aircraft: fix.t || fix.r || null,
      latitude: Number(fix.lat),
      longitude: Number(fix.lon),
      altitudeFeet: fix.alt_baro != null && fix.alt_baro !== "ground" ? Number(fix.alt_baro) : null,
      groundspeedKnots: fix.gs != null ? Number(fix.gs) : null,
      positionSource: "adsb.fi ADS-B",
      positionUpdatedAgo: age < 5 ? "just now" : `${age} sec ago`,
      trackingHttpStatus: null,
      trackingResponseType: "adsb-live-position",
      adsbHttpStatus: response.status,
      message: `Live aircraft position from adsb.fi ADS-B; position age ${age} sec. FlightNerve was not called.`
    });
  } catch (_) {
    return res.status(200).json({
      flight: "NH7",
      status: "Live position unavailable",
      latitude: null,
      longitude: null,
      positionSource: null,
      positionUpdatedAgo: null,
      trackingHttpStatus: null,
      adsbHttpStatus: null,
      message: "Could not contact the public ADS-B feed. No live coordinates are available right now. FlightNerve was not called."
    });
  }
}
