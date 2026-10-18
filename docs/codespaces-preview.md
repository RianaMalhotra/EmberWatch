# Preview EmberWatch in GitHub Codespaces

Open **Code → Codespaces** on the repository and create/open a codespace.

Start Flask in the first terminal (from the repository root):

```bash
cd backend
python -m pip install -r requirements.txt
CORS_ORIGINS="https://YOUR-CODESPACE-NAME-5173.app.github.dev" python app.py
```

Replace `YOUR-CODESPACE-NAME` with the exact prefix of your forwarded frontend URL (everything before `-5173.app.github.dev`). Alternatively export `CORS_ORIGINS` in the terminal before starting Flask. If the backend requires database credentials, configure `DATABASE_URL` privately in `backend/.env` or your shell; do not commit credentials. The risk-area endpoint currently serves explicitly labeled mock data.

Start Vite in a second terminal (from the repository root):

```bash
cd frontend
npm ci
npm run dev -- --host 0.0.0.0
```

Open the forwarded **5173** port from the Codespaces **Ports** tab. The frontend automatically targets the corresponding HTTPS **5000** forwarded port in Codespaces; locally it still defaults to `http://127.0.0.1:5000`. You can override this with `VITE_API_BASE_URL` in `frontend/.env.local` (restart Vite after changing it).

If browser requests to port **5000** return authentication errors, check its visibility in the **Ports** tab. For a throwaway development backend **without credentials or sensitive data**, you can temporarily set the forwarded 5000 port to Public, then switch it back to Private when finished. Do not publicly expose a debug server with sensitive environment variables or production database access. The Flask backend is currently started with debug mode by `python app.py`; do not expose it publicly in that mode. For a temporary public preview, run `flask --app app run --host 0.0.0.0 --port 5000 --no-debugger --no-reload` instead.

If the map tiles still fail, the CARTO basemap may also be subject to network restrictions and provider usage policies. This project uses the CARTO light basemap for its development preview, with required attributions.
