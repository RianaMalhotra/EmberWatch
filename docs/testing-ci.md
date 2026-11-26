# Sprint 2 test baseline and CI (#30)

## Existing automation

`.github/workflows/tests.yml` runs on pull requests targeting `main`, pushes to `main`, and manual dispatch. It runs backend Pytest, frontend Vitest, frontend lint, and a production build. This change adds backend coverage measurement and an uploaded XML coverage artifact, while preserving existing checks.

## Critical functionality

The coverage command targets `services.detection_pipeline`, `services.detection_validation`, `services.detection_filter`, and `services.risk_scoring`. These modules implement the detection classification, validation, threshold filtering and environmental risk model. Flask endpoint contracts are covered by `backend/tests/test_app.py`, `test_sprint1_integration.py`, and `test_sprint2_regression.py`. Frontend map selection and API-error behavior are tested in `frontend/src/App.test.jsx`.

## Run locally

From the repository root:

```bash
cd backend
python -m pip install -r requirements.txt
python -m pytest -q --cov=services.detection_pipeline --cov=services.detection_validation --cov=services.detection_filter --cov=services.risk_scoring --cov-report=term-missing --cov-report=xml:coverage.xml
```

Data processing (FIRMS cleaning, loading and validation, threshold backtest and held-out evaluation; no database needed). CI runs this as the "Data Processing Tests" job (#46):

```bash
python -m pip install pytest
python -m pytest tests -q
```

The burned-area check tests (`tests/test_evaluate_against_nbac_maps.py`) need geopandas, shapely and pyproj, which CI does not install, so they are skipped there. Run them locally with `pip install -r ml/requirements-nbac.txt` and then `python -m pytest tests -q`.

Frontend:

```bash
cd frontend
npm ci
npm test -- --run
npm run lint
npm run build
```

The target for identified critical functions is **at least 80% statement coverage**. #30 first only reported coverage; the gate is now enforced: the Backend Tests job in `.github/workflows/tests.yml` runs pytest with `--cov-fail-under=80` over the seven critical service modules, so CI fails below 80%. Measured coverage on `main` (Nov 26, 2026, commit `6dcb585`) was 99%; see [Acceptance traceability](acceptance-traceability.md).

## Branch protection

CI running does **not** by itself prevent merges. A repository administrator must configure `main` branch protection or a ruleset requiring the **Backend Tests** and **Frontend Tests** checks before merge. Confirm the exact check names from a completed PR run. This step requires repository settings permission and is not performed by this documentation change.

## No credentials needed

Backend tests use mocked connections. Never commit `backend/.env`, database URLs, passwords or production tokens. Real database integration tests are a separate, controlled test environment task.

Related issues: #20, #22, #29, #30.
