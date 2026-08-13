import importlib.util
import sys
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent

# See agent-service/tests/conftest.py for why this isn't a plain `import main`:
# both services have a main.py, and loading them under the same sys.modules key
# would let one shadow the other in a combined test run.
if "rules_service_main" not in sys.modules:
    spec = importlib.util.spec_from_file_location("rules_service_main", SERVICE_DIR / "main.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["rules_service_main"] = module
    spec.loader.exec_module(module)
