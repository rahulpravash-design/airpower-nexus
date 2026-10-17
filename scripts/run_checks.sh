#!/usr/bin/env bash
# Runs every automated check and records the real backend test outcome for the Diagnostics page.
#   scripts/run_checks.sh            (uses ./venv or $PYTHON, and web/node_modules)
set -uo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-$( [ -x venv/bin/python ] && echo venv/bin/python || echo python3 )}"
mkdir -p airops/results
status=0

echo "== backend: pytest =="
$PY -m pytest -o addopts="" -q --junitxml=airops/results/junit.xml || status=1
$PY - <<'PY'
import json, datetime, xml.etree.ElementTree as ET
r = ET.parse("airops/results/junit.xml").getroot()
s = r if r.tag == "testsuite" else r.find("testsuite")
total, fail, err, skip = (int(s.get(k, 0)) for k in ("tests", "failures", "errors", "skipped"))
rep = {"total": total, "passed": total - fail - err - skip, "failed": fail + err, "skipped": skip,
       "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
       "summary": f"{total - fail - err - skip}/{total} passed, {fail + err} failed (pytest)"}
json.dump(rep, open("airops/results/test_report.json", "w"), indent=2)
print(rep["summary"])
PY

echo "== web: typecheck, unit tests, production build =="
(cd web && npx tsc -p tsconfig.json --noEmit && npx vitest run && npm run build) || status=1
exit $status
