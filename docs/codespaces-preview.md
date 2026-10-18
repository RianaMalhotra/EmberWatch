# Preview EmberWatch in GitHub Codespaces

Open the repository in GitHub Codespaces. In the first terminal:

```bash
cd /workspaces/EmberWatch/backend
python -m pip install -r requirements.txt
flask --app app run --host 127.0.0.1 --port 5000 --no-debugger --no-reload
```

In a second terminal:

```bash
cd /workspaces/EmberWatch/frontend
npm ci
npm run dev -- --host 0.0.0.0
```

In Codespaces **Ports**, open the forwarded **5173** URL. The frontend calls `/api/...` on the same origin; Vite proxies those requests internally to Flask at `127.0.0.1:5000`. Port 5000 does **not** need to be public, and Codespaces CORS origins do not need to be configured for this development setup.

If `frontend/.env.local` contains `VITE_API_BASE_URL`, remove or comment it out to use the proxy, then restart Vite. A deployed production frontend can instead configure that variable to the deployed backend URL and enable CORS on Flask.

The risk-area endpoint currently serves labeled mock data. The detection endpoint requires valid private database configuration; without it, detections can correctly report unavailable. Never commit database credentials.

The preview map uses Esri WorldTopoMap tiles. Tile availability and permitted usage depend on Esri's terms and network access.
