# Smart Geospatial System

## Run locally

Start the API in one terminal:

```powershell
cd Backend
npm install
npm start
```

Start the Vite frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the `Local` URL printed by Vite. In local development, Vite forwards `/api` requests to `http://127.0.0.1:5000`.

## Deploy the API to Render

The repository includes `render.yaml` for the Express API. In Render, create a Blueprint and connect this GitHub repository. Keep the service root directory at the repository root. After the frontend is deployed, set `FRONTEND_ORIGIN` in the Render service to the deployed frontend origin, for example `https://your-app.vercel.app` (no trailing slash). Multiple exact origins can be comma-separated.

The API serves district GeoJSON, 2024 crime data, and population data from files in this repository. The `/api/health` endpoint reports whether the API is running.

## Deploy the frontend to Vercel

Create a Vercel project connected to this repository and set its Root Directory to `frontend`. Vercel detects Vite; use `npm run build` as the build command and `dist` as the output directory. Add this environment variable in the Vercel project settings:

```text
VITE_API_BASE_URL=https://your-api.onrender.com
```

Use the actual Render URL and do not add a trailing slash. Redeploy after setting the variable. Then add the Vercel production URL to Render's `FRONTEND_ORIGIN` setting and redeploy the API.

For local development, leave `VITE_API_BASE_URL` unset; the Vite proxy will route API requests to the local backend.
