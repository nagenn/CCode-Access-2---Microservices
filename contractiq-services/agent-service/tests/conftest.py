import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

SERVICE_DIR = Path(__file__).resolve().parent.parent

# agent-service/main.py can't be imported as `import main` safely: rules-service
# also has a main.py, and if both test suites ever run in one pytest session
# (e.g. `pytest contractiq-services`), a plain `import main` would resolve
# whichever module got into sys.modules first. Load this file under a name
# unique to this service instead.
if "agent_service_main" not in sys.modules:
    spec = importlib.util.spec_from_file_location("agent_service_main", SERVICE_DIR / "main.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["agent_service_main"] = module
    spec.loader.exec_module(module)

import agent_service_main as main  # noqa: E402


@pytest.fixture
def isolated_reviews_db(tmp_path, monkeypatch):
    """Points the reviews table at a throwaway sqlite file for the duration of a test.

    get_reviews_db() reads main.REVIEWS_DB_PATH at call time (not a bound default),
    so patching the module attribute is enough to redirect every subsequent call —
    no reload needed, and the real reviews.db is never touched.
    """
    db_path = tmp_path / "reviews.db"
    monkeypatch.setattr(main, "REVIEWS_DB_PATH", str(db_path))
    main.init_reviews_db()
    return db_path


DEFAULT_LLM_JUDGMENT = {
    "risk_score": "Low",
    "missing_clauses": [],
    "problematic_terms": [],
    "key_obligations": [],
    "recommendations": "",
    "confidence": 0.95,
}


def fake_completion(content: str = json.dumps(DEFAULT_LLM_JUDGMENT)) -> MagicMock:
    """Builds a MagicMock shaped like an OpenAI ChatCompletion response, i.e. one
    whose .choices[0].message.content is `content`. run_llm_judgment() only ever
    reads that one path off the response, so that's all this needs to fake.
    """
    completion = MagicMock()
    completion.choices = [MagicMock(message=MagicMock(content=content))]
    return completion


@pytest.fixture(autouse=True)
def mock_openai_completion(monkeypatch):
    """Replaces client.chat.completions.create with a mock for every test in this
    suite, by default returning a well-formed judgment. Autouse so this applies
    even to tests that don't request it -- e.g. a future /analyze or
    run_llm_judgment() test that doesn't realize it's on a path that reaches the
    real OpenAI client -- so no test can accidentally fire a real network call.

    A test that needs specific LLM behavior (a parse-failure case, a specific
    risk_score/confidence combination, etc.) requests this fixture by name and
    overrides it, e.g.:

        def test_x(mock_openai_completion):
            mock_openai_completion.return_value = fake_completion("not json")
            ...
    """
    mock_create = MagicMock(return_value=fake_completion())
    monkeypatch.setattr(main.client.chat.completions, "create", mock_create)
    return mock_create
