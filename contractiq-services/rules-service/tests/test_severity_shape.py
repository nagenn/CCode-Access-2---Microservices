from fastapi.testclient import TestClient
import rules_service_main as main


def test_build_rules_uses_severity_code_not_severity():
    """rules-service/README.md documents GET /rules as returning
    `severity: "high"|"medium"|"low"` (a string). The real code has never produced
    that field -- build_rules() emits `severity_code` (an int) only, bridged to a
    `severity` label solely inside agent-service's map_severity(). This locks in
    the actual wire shape so the drift is caught here instead of by a client
    written against the README.
    """
    rules = {
        "required_clauses": ["Confidentiality"],
        "prohibited_terms": ["non-compete"],
        "risk_thresholds": {"payment_terms": "Net 30"},
        "escalation_rules": {"confidence_below": 0.75},
    }

    entries = main.build_rules(rules)

    assert len(entries) == 4
    for entry in entries:
        assert "severity_code" in entry
        assert isinstance(entry["severity_code"], int)
        assert "severity" not in entry


def test_build_rules_severity_codes_by_category():
    rules = {
        "required_clauses": ["A"],
        "prohibited_terms": ["B"],
        "risk_thresholds": {"x": "y"},
        "escalation_rules": {"confidence_below": 0.75},
    }

    by_id = {e["id"]: e for e in main.build_rules(rules)}

    assert by_id["required_clause_1"]["severity_code"] == 1
    assert by_id["prohibited_term_1"]["severity_code"] == 1
    assert by_id["risk_threshold_x"]["severity_code"] == 2
    assert by_id["escalation_confidence_below"]["severity_code"] == 3


def test_build_rules_empty_input_returns_empty_list():
    assert main.build_rules({}) == []


def test_get_rules_endpoint_response_also_uses_severity_code(monkeypatch):
    """Same assertion at the actual HTTP boundary -- what the README's claim is
    actually about -- not just the pure function underneath it.
    """
    class FakeIngestionResponse:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"exists": True, "trace": []}

    def fake_get(url, timeout=5):
        return FakeIngestionResponse()

    monkeypatch.setattr(main.requests, "get", fake_get)

    client = TestClient(main.app)
    response = client.get("/rules", params={"filename": "contract.pdf"})

    assert response.status_code == 200
    rules = response.json()["rules"]
    assert len(rules) > 0
    for entry in rules:
        assert "severity_code" in entry
        assert "severity" not in entry
