import app as backend_app

def test_metrics_are_hidden_without_token(monkeypatch):
    monkeypatch.delenv("METRICS_TOKEN", raising=False)
    client = backend_app.app.test_client()
    assert client.get("/api/internal/metrics").status_code == 404
    assert client.get("/api/internal/metrics", headers={"Authorization": "Bearer guessed"}).status_code == 404

def test_metrics_require_exact_token(monkeypatch):
    monkeypatch.setenv("METRICS_TOKEN", "test-operator-token")
    client = backend_app.app.test_client()
    assert client.get("/api/internal/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 404
    client.get("/api/health")
    response = client.get("/api/internal/metrics", headers={"Authorization": "Bearer test-operator-token"})
    assert response.status_code == 200
    assert "health_check" in response.get_json()["endpoints"]
