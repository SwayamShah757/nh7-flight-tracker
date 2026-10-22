# NH7 Flight Watch — GitHub Pages frontend

This version includes:
- `index.html`: home page
- `tracker.html`: map + status + estimated arrival UI; polls every 60 seconds
- `style.css`: shared styling
- `api/flight.js`: serverless backend proxy for FlightAware AeroAPI
- `vercel.json`: backend deployment configuration

## Important architecture note

GitHub Pages hosts static HTML/CSS/JS only; it cannot run `api/flight.js` as a backend. Keep the frontend on GitHub Pages and deploy the `api/` function to Vercel (or another serverless host). The frontend's `fetch('./api/flight?...')` path will need to be changed to the deployed backend URL if the backend is hosted on a different domain.

## Setup outline

1. Create a GitHub repository and upload `index.html`, `tracker.html`, and `style.css` to the repository root.
2. In repository Settings → Pages, enable deployment from the `main` branch and root folder. GitHub Pages publishes the home page at the site's root.
3. Import this same repository into Vercel to deploy the `api/flight.js` function.
4. Get a FlightAware AeroAPI key and add it in Vercel Project Settings → Environment Variables as `AEROAPI_KEY`. Never put this key in any HTML, JavaScript, GitHub commit, or public issue.
5. Redeploy the Vercel project after adding the variable.
6. If frontend and backend are on different domains, edit `tracker.html`: change `fetch('./api/flight?...')` to the full Vercel function URL, for example `https://YOUR-VERCEL-DOMAIN.vercel.app/api/flight?...`. The backend may also need CORS headers allowing your exact GitHub Pages origin; add them before using cross-origin fetch.
7. Test with a flight/date for which your AeroAPI plan provides data. The API function is a starter integration: provider response fields can vary by flight, and may need adjustment against the live response and current AeroAPI docs.

## The story behind NH7 Flight Watch

More than a flight home
This website was made for the students and friends from Toyokawa, Japan, who took part in the Cupertino–Toyokawa Sister Cities exchange. During the exchange, we got to share our everyday lives, learn about each other’s cultures, and build friendships that reach across the Pacific.

When it was time for the Toyokawa delegation to head home, I wanted to make something that would help us follow their journey from San Francisco to Tokyo—and give everyone one more way to show how much we’ll miss them. NH7 Flight Watch is my small way of turning a flight number into a reminder of the people, memories, and connections behind it.

## That is what the exchange is about to me: not just visiting another country, but discovering how people from different places can become part of one another’s lives. The trip ends, but the friendship doesn’t. ❤️

This is implementation-ready scaffolding, not a verified live connection. It will show "Backend is not configured yet" until the API key is set on the backend. No API key is included in these files.
