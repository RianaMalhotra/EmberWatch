from services import observability

def test_records_counts_and_latency_without_user_input():
    observability.record_request("risk_score", 200, 12.5)
    observability.record_request("risk_score", 503, 25)
    result = observability.snapshot()["endpoints"]["risk_score"]
    assert result["requests"] >= 2
    assert result["status_classes"]["2xx"] >= 1
    assert result["status_classes"]["5xx"] >= 1
    assert result["latency_ms_p95"] >= 12.5

def test_latency_samples_are_bounded():
    for i in range(250):
        observability.record_request("bounded_test", 200, i)
    assert len(observability._durations["bounded_test"]) == 200
