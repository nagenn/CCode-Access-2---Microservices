import agent_service_main as main


def test_maps_known_severity_codes_to_labels():
    rules = [
        {"id": "a", "description": "x", "severity_code": 1},
        {"id": "b", "description": "y", "severity_code": 2},
        {"id": "c", "description": "z", "severity_code": 3},
    ]

    mapped = main.map_severity(rules)

    assert [r["severity"] for r in mapped] == ["high", "medium", "low"]
    # Original fields (including severity_code) must survive the merge —
    # map_severity spreads the rule and adds severity, it doesn't replace it.
    assert [r["severity_code"] for r in mapped] == [1, 2, 3]
    assert [r["id"] for r in mapped] == ["a", "b", "c"]


def test_unknown_severity_code_falls_back_to_unknown_label():
    rules = [{"id": "d", "description": "w", "severity_code": 99}]

    mapped = main.map_severity(rules)

    assert mapped[0]["severity"] == "unknown"


def test_missing_severity_code_falls_back_to_unknown_label():
    rules = [{"id": "e", "description": "v"}]

    mapped = main.map_severity(rules)

    assert mapped[0]["severity"] == "unknown"


def test_empty_rule_list_returns_empty_list():
    assert main.map_severity([]) == []
