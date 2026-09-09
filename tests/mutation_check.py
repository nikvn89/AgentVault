#!/usr/bin/env python3
"""
Mutation check — does the AgentVault suite actually have teeth?

A suite that passes proves nothing until it is shown to fail when the contract
is wrong. This makes 22 small, targeted edits to `contracts/AgentVault.py` —
each one a plausible mistake that breaks a property the suite claims to protect
— and runs the whole suite against each mutant on real GenVM.

  KILLED    at least one test failed. The property is genuinely defended.
  SURVIVED  every test still passed. That mutant is an untested gap.

Nothing under `contracts/` is modified: each mutant goes to a temporary
directory and the suite is pointed at it through AGENTVAULT_CONTRACT.

    python3 tests/mutation_check.py
"""

import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACT = os.path.join(ROOT, "contracts", "AgentVault.py")
TESTS = os.path.join(ROOT, "tests")

MUTANTS = [
    ("M01", "the agent may be the principal",
     "        if agent_address == principal:",
     "        if False:"),
    ("M02", "the agent may be listed as a recipient",
     '            if recipient_key == agent_key:\n                raise gl.vm.UserError(\n                    "Agent cannot be recipient"\n                )',
     '            if False:\n                raise gl.vm.UserError(\n                    "Agent cannot be recipient"\n                )'),
    ("M03", "a recipient may appear twice",
     '                raise gl.vm.UserError(\n                    "Duplicate recipient"\n                )',
     "                pass"),
    ("M04", "a recipient needs no label",
     '                raise gl.vm.UserError(\n                    "Recipient label required"\n                )',
     "                pass"),
    ("M05", "the per-action cap may exceed the budget",
     '            raise gl.vm.UserError(\n                "Per-action cap cannot exceed total budget"\n            )',
     "            pass"),
    ("M06", "a zero or negative budget is accepted",
     '            raise gl.vm.UserError(\n                "Total budget must be greater than zero"\n            )',
     "            pass"),
    ("M07", "funding may exceed the mandate budget",
     '            raise gl.vm.UserError(\n                "Funding exceeds mandate budget"\n            )',
     "            pass"),
    ("M08", "anyone may act as the principal",
     '        if caller != principal:\n            raise gl.vm.UserError(\n                "Principal only"\n            )',
     '        if False:\n            raise gl.vm.UserError(\n                "Principal only"\n            )'),
    ("M09", "anyone may act as the agent",
     '        if caller != agent:\n            raise gl.vm.UserError(\n                "Registered agent only"\n            )',
     '        if False:\n            raise gl.vm.UserError(\n                "Registered agent only"\n            )'),
    ("M10", "a revoked or expired mandate still accepts requests",
     '        if self._derived_status_for(\n            mandate\n        ) != "ACTIVE":\n            raise gl.vm.UserError(\n                "Mandate is not active"\n            )',
     '        if False:\n            raise gl.vm.UserError(\n                "Mandate is not active"\n            )'),
    ("M11", "a zero or negative amount is accepted",
     '            raise gl.vm.UserError(\n                "Amount must be greater than zero"\n            )',
     "            pass"),
    ("M12", "the per-action cap is ignored",
     '            raise gl.vm.UserError(\n                "Amount exceeds per-action cap"\n            )',
     "            pass"),
    ("M13", "the remaining budget is ignored",
     '            raise gl.vm.UserError(\n                "Amount exceeds remaining budget"\n            )',
     "            pass"),
    ("M14", "the funded balance is ignored",
     '            raise gl.vm.UserError(\n                "Mandate has insufficient funded balance"\n            )',
     "            pass"),
    ("M15", "a request needs no description",
     '            raise gl.vm.UserError(\n                "Description required"\n            )',
     "            pass"),
    ("M16", "the recipient allowlist is ignored",
     '        if recipient_key not in recipients:',
     "        if False:"),
    ("M17", "the agent may pay itself at request time",
     '        agent_key = str(\n            mandate["agent"]\n        ).lower()'
     '\n\n        if recipient_key == agent_key:',
     '        agent_key = str(\n            mandate["agent"]\n        ).lower()'
     "\n\n        if False:"),
    ("M18", "a refused request no longer consumes an action slot",
     '        mandate[\n            "actions_used"\n        ] = (\n            int(\n                mandate[\n                    "actions_used"\n                ]\n            )\n            + 1\n        )',
     '        mandate[\n            "actions_used"\n        ] = int(\n            mandate[\n                "actions_used"\n            ]\n        )'),
    ("M19", "the per-principal mandate cap is removed",
     "            >= self.MAX_MANDATES_PER_PRINCIPAL",
     "            >= 100000"),
    ("M20", "the clock treats every year as a leap year",
     "        if m <= 2:\n            y -= 1",
     "        if m <= 1:\n            y -= 1"),
    ("M21", "the clock ignores the minutes field",
     "        if minute < 0 or minute > 59:",
     "        if False:"),
    ("M22", "a malformed chain datetime is accepted",
     '        if len(raw) < 19:\n            raise gl.vm.UserError(\n                "Invalid chain datetime"\n            )',
     '        if False:\n            raise gl.vm.UserError(\n                "Invalid chain datetime"\n            )'),
]


def run_suite(contract_path):
    env = dict(os.environ, AGENTVAULT_CONTRACT=contract_path)
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", TESTS, "-q", "-p", "no:cacheprovider"],
        cwd=ROOT, env=env, capture_output=True, text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main():
    source = open(CONTRACT, encoding="utf-8").read()

    code, output = run_suite(CONTRACT)
    if code != 0:
        print("Baseline suite is already failing; fix that first.\n")
        print(output[-2500:])
        return 1
    print("baseline            PASS\n")

    workdir = tempfile.mkdtemp(prefix="agentvault-mutants-")
    killed, survived, invalid = [], [], []

    try:
        for mutant_id, description, old, new in MUTANTS:
            if source.count(old) != 1:
                invalid.append((mutant_id, description))
                print(f"{mutant_id}  INVALID   pattern matched "
                      f"{source.count(old)} times -- {description}")
                continue

            path = os.path.join(workdir, f"{mutant_id}.py")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(source.replace(old, new))

            code, _ = run_suite(path)
            if code == 0:
                survived.append((mutant_id, description))
                print(f"{mutant_id}  SURVIVED  {description}")
            else:
                killed.append((mutant_id, description))
                print(f"{mutant_id}  killed    {description}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    print(f"\n{len(killed)}/{len(MUTANTS)} killed, {len(survived)} survived, "
          f"{len(invalid)} invalid")

    if survived or invalid:
        print("\nUntested gaps:")
        for mutant_id, description in survived + invalid:
            print(f"  {mutant_id}  {description}")

    return 0 if not survived and not invalid else 1


if __name__ == "__main__":
    sys.exit(main())
