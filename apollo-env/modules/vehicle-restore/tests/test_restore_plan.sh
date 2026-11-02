#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$ROOT/scripts/restore_plan.py"
TMP="$(mktemp -d /tmp/apollo-env-plan-test-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
WS="$TMP/ws"; BASELINES="$TMP/baselines"; REG="$TMP/targets.yaml"
mkdir -p "$WS/profiles/CAR/modules/drivers" "$WS/profiles/CAR/modules/planning" "$WS/modules/drivers/pkg" "$WS/modules/planning/pkg" "$BASELINES/CAR/v1"
ln -s CAR "$WS/profiles/current"; ln -s v1 "$BASELINES/CAR/latest"
printf '%s\n' '{"version":"11.0.0"}' > "$WS/.workspace.json"
printf '%s\n' 'target_id: CAR' 'profile_package: CAR' 'apollo_version: "11.0.0"' > "$WS/profiles/CAR/.apollo_vehicle_stamp.yaml"
printf '%s\n' 'targets:' '  - id: CAR' '    version: "11.0.0"' '    profile_package: CAR' > "$REG"
printf '%s\n' old > "$WS/profiles/CAR/modules/drivers/conf.txt"
printf '%s\n' same > "$WS/profiles/CAR/modules/planning/conf.txt"
printf '%s\n' old > "$WS/modules/drivers/pkg/code.cc"
printf '%s\n' same > "$WS/modules/planning/pkg/code.cc"
printf '%s\n' '<package/>' > "$WS/modules/drivers/pkg/cyberfile.xml"
printf '%s\n' '<package/>' > "$WS/modules/planning/pkg/cyberfile.xml"
mkdir -p "$TMP/src/profiles/CAR/modules/drivers" "$TMP/src/profiles/CAR/modules/planning" "$TMP/src/modules/drivers/pkg" "$TMP/src/modules/planning/pkg"
printf '%s\n' new > "$TMP/src/profiles/CAR/modules/drivers/conf.txt"
printf '%s\n' same > "$TMP/src/profiles/CAR/modules/planning/conf.txt"
printf '%s\n' new > "$TMP/src/modules/drivers/pkg/code.cc"
printf '%s\n' same > "$TMP/src/modules/planning/pkg/code.cc"
printf '%s\n' '<package/>' > "$TMP/src/modules/drivers/pkg/cyberfile.xml"
printf '%s\n' '<package/>' > "$TMP/src/modules/planning/pkg/cyberfile.xml"
tar -czf "$BASELINES/CAR/v1/params.tgz" -C "$TMP/src" profiles
tar -czf "$BASELINES/CAR/v1/code.tgz" -C "$TMP/src" modules
PSHA="$(sha256sum "$BASELINES/CAR/v1/params.tgz" | awk '{print $1}')"; CSHA="$(sha256sum "$BASELINES/CAR/v1/code.tgz" | awk '{print $1}')"
printf '%s\n' 'artifact:' '  path: params.tgz' "  sha256: $PSHA" '  archive_root: profiles/CAR' > "$BASELINES/CAR/v1/parameters.yaml"
printf '%s\n' 'artifact:' '  path: code.tgz' "  sha256: $CSHA" '  archive_root: modules' > "$BASELINES/CAR/v1/code.yaml"
python3 "$TOOL" detect --workspace "$WS" --registry "$REG" --json | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["target_id"]=="CAR" and d["status"]=="detected"'
for scope in full sensor; do
  python3 "$TOOL" plan --workspace "$WS" --registry "$REG" --baseline-root "$BASELINES" --scope "$scope" --json > "$TMP/$scope.json"
done
python3 "$TOOL" plan --workspace "$WS" --registry "$REG" --baseline-root "$BASELINES" --scope module --module planning --json > "$TMP/module.json"
python3 - "$TMP/full.json" "$TMP/sensor.json" "$TMP/module.json" <<'PY'
import json,sys
full,sensor,module=[json.load(open(x)) for x in sys.argv[1:]]
assert full['ready_to_apply'] and full['parameters']['change_count']==1 and full['code']['change_count']==1
assert sensor['modules']==['drivers','perception','transform'] and sensor['parameters']['change_count']==1 and sensor['code']['change_count']==1
assert module['modules']==['planning'] and module['parameters']['change_count']==0 and module['code']['change_count']==0
assert sensor['build_packages']==['modules/drivers/pkg']
PY
python3 "$TOOL" execute --workspace "$WS" --registry "$REG" --plan "$TMP/sensor.json" | grep -q 'no files changed'
if python3 "$TOOL" execute --workspace "$WS" --registry "$REG" --plan "$TMP/sensor.json" --apply --confirm-plan wrong >/dev/null 2>&1; then
  echo 'apply without exact plan confirmation unexpectedly accepted' >&2; exit 1
fi
python3 - "$TMP/sensor.json" <<'PY'
import json,sys
path=sys.argv[1]; data=json.load(open(path)); data['scope']='full'
with open(path,'w') as out: json.dump(data,out)
PY
if python3 "$TOOL" execute --workspace "$WS" --registry "$REG" --plan "$TMP/sensor.json" >/dev/null 2>&1; then
  echo 'tampered plan unexpectedly accepted' >&2; exit 1
fi
grep -q '^old$' "$WS/profiles/CAR/modules/drivers/conf.txt"
grep -q '^old$' "$WS/modules/drivers/pkg/code.cc"
echo 'restore_plan tests passed (no restore executed)'
