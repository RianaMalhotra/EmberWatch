import pytest

from config import DEFAULT_CORS_ORIGINS, get_cors_origins


def test_default_origin_used_when_env_not_set(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert get_cors_origins() == DEFAULT_CORS_ORIGINS


def test_origins_read_from_environment(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example.com/, https://b.example.com")
    assert get_cors_origins() == ["https://a.example.com", "https://b.example.com"]


@pytest.mark.parametrize("raw", ["", "  ", " , "])
def test_blank_value_falls_back_to_default(monkeypatch, raw):
    monkeypatch.setenv("CORS_ORIGINS", raw)
    assert get_cors_origins() == DEFAULT_CORS_ORIGINS


def test_default_list_is_not_shared(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    get_cors_origins().append("https://evil.example.com")
    assert get_cors_origins() == ["http://localhost:5173"]
