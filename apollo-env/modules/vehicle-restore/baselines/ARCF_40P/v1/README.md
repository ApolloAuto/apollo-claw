# ARCF_40P v1 baseline

This baseline records the user-confirmed healthy Apollo 11.0.0 ARCF_40P environment.

## Recorded components

- Parameters: `parameters.yaml`
- Vehicle code: `code.yaml`
- Parameter artifact: `baselines/ARCF_40P/apollo_profiles.tar.gz`
- Code artifact: `baselines/ARCF_40P/apollo_code.tar.gz`
- Active profile link: `/apollo_workspace/profiles/current -> /apollo_workspace/profiles/ARCF_40P`
- Temporary profile for safe replacement: `sample`
- Build workspace: `/apollo_workspace`
- Build command: `buildtool build -p <code_directory>`
- Recorded at: 2026-09-14

## Restore order

1. Verify identity via the in-profile stamp, not via `profiles/current` or `APOLLO_ENV_NAME`:
   `bash scripts/vehicle_stamp.sh verify --target ARCF_40P --workspace /apollo_workspace`
   Exit 3 = identity mismatch, stop. Exit 4 = same vehicle, parameters drifted, report and continue.
2. Back up parameters, code, the `current` link, version data, and Git state.
3. Run `aem profile use sample` from `/apollo_workspace`.
4. Confirm `current` no longer points to `ARCF_40P`; a non-zero command result is only tolerated when this post-check passes.
5. Restore the ARCF_40P parameter directory, never through `profiles/current`.
6. Run `aem profile use ARCF_40P` from `/apollo_workspace`.
7. Confirm `current` points back to `profiles/ARCF_40P`.
8. Check and restore `/apollo_workspace/modules` against the code baseline.
9. Run `buildtool build -p <code_directory>` from `/apollo_workspace`.
10. Verify hashes, installed outputs, profile link, and final version report.

The archive checksums and counts in the YAML files are the integrity record.
Do not mark a later update as v1; create the next version after the updated parameters and code are confirmed healthy.
