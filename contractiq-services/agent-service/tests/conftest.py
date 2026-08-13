import importlib.util
import sys
from pathlib import Path

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
