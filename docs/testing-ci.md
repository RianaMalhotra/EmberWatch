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

Data processing (FIRMS cleaning, loading and validation, threshold backtest; no database needed). CI runs this as the "Data Processing Tests" job (#46):

```bash
python -m pip install pytest
python -m pytest tests -q
```

Frontend:

```bash
cd frontend
npm ci
npm test -- --run
npm run lint
npm run build
```

The target for identified critical functions is **at least 80% statement coverage**. This PR initially **reports** coverage without asserting the threshold, because the baseline must be measured from a completed CI run first. Review the report, add missing tests, then introduce `--cov-fail-under=80` once the suite reaches the target. Do not claim 80% is met before reviewing the report.

## Branch protection

CI running does **not** by itself prevent merges. A repository administrator must configure `main` branch protection or a ruleset requiring the **Backend Tests** and **Frontend Tests** checks before merge. Confirm the exact check names from a completed PR run. This step requires repository settings permission and is not performed by this documentation change.

## No credentials needed

Backend tests use mocked connections. Never commit `backend/.env`, database URLs, passwords or production tokens. Real database integration tests are a separate, controlled test environment task.

Related issues: #20, #22, #29, #30.
