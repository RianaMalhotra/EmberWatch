"""Every environment variable the backend reads must be documented (issue #61).

A new setting that is only in the code can't be found by whoever deploys the
app. This fails when backend code reads a variable that is missing from
backend/.env.example or docs/deployment-vercel-render.md.
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")

# Read in code but set by the hosting platform, so it has no line in .env.example.
SET_BY_HOST = {"RENDER"}

READ = re.compile(r"""(?:os\.environ\.get|os\.getenv|os\.environ\[|_positive_int_env)\(?\s*["']([A-Z][A-Z0-9_]+)["']""")


def _backend_sources():
    for folder, dirs, files in os.walk(BACKEND):
        dirs[:] = [d for d in dirs if d not in ("tests", ".venv", "__pycache__")]
        for name in files:
            if name.endswith(".py") and name != "check_db.py":
                yield os.path.join(folder, name)


def variables_read_by_backend():
    found = set()
    for path in _backend_sources():
        with open(path, encoding="utf-8") as handle:
            found.update(READ.findall(handle.read()))
    return found


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


def test_the_scan_finds_the_variables_we_know_about():
    names = variables_read_by_backend()
    assert {"DATABASE_URL", "CORS_ORIGINS", "REPORT_HASH_SALT", "OPENAI_API_KEY", "METRICS_TOKEN"} <= names


def test_every_backend_variable_is_in_env_example():
    example = _read("backend", ".env.example")
    missing = sorted(n for n in variables_read_by_backend() - SET_BY_HOST if not re.search(rf"\b{n}\b", example))
    assert not missing, f"Add these to backend/.env.example: {missing}"


def test_every_backend_variable_is_in_the_deployment_doc():
    doc = _read("docs", "deployment-vercel-render.md")
    missing = sorted(n for n in variables_read_by_backend() if not re.search(rf"\b{n}\b", doc))
    assert not missing, f"Add these to docs/deployment-vercel-render.md: {missing}"
