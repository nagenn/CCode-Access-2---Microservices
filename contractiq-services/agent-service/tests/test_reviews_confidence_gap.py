from fastapi.testclient import TestClient
import agent_service_main as main


def test_reviews_endpoint_accepts_no_confidence_field(isolated_reviews_db):
    """Characterizes the current gap: POST /reviews's request model has no
    `confidence` field at all, so nothing server-side can check it against the
    escalation threshold. A caller can persist status="cleared" for what was,
    client-side, a low-confidence result -- or bypass deriveReviewStatus() entirely
    -- and the backend accepts it without complaint. This test should start
    failing the day server-side enforcement is added; that's the point of it.
    """
    client = TestClient(main.app)

    response = client.post("/reviews", json={
        "filename": "low_confidence_contract.pdf",
        "review_type": "agent",
        "status": "cleared",
        "risk_level": "Low",
        # ReviewCreate has no confidence field, so even sending one here is a
        # no-op -- Pydantic silently drops unrecognized fields by default.
        "confidence": 0.1,
    })

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "cleared"
    assert "confidence" not in body


def test_confidence_never_persisted_across_a_review_round_trip(isolated_reviews_db):
    """Even when a caller sends confidence, it never survives to GET /reviews -- the
    reviews table has no column for it. A reviewer looking at review history has no
    way to see what confidence value justified a past escalation decision, or to
    tell an escalation driven by low confidence apart from one driven by risk.
    """
    client = TestClient(main.app)

    create_response = client.post("/reviews", json={
        "filename": "contract.pdf",
        "review_type": "agent",
        "status": "escalated",
        "risk_level": "Medium",
        "confidence": 0.42,
    })
    assert create_response.status_code == 201
    assert "confidence" not in create_response.json()

    list_response = client.get("/reviews")
    assert list_response.status_code == 200
    rows = list_response.json()
    assert len(rows) == 1
    assert "confidence" not in rows[0]
    assert rows[0]["status"] == "escalated"
