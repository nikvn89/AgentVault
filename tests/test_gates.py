"""
The deterministic gates in `request_action`, which all run before any model.

This is the separation the whole design rests on: consensus decides only
*whether the described purpose fits the mandate*. Who may spend, how much, how
often, to whom and until when are contract rules, settled before a prompt is
ever built. Almost every test below therefore runs with **no model answer armed** — if
one of these gates stopped working, the request would reach `exec_prompt` and
fail there instead, which is a different error and would show up as a failure
here rather than a silent pass. The caller gate is the exception: reaching
`exec_prompt` is exactly what a broken caller gate would do, so that one test
arms an answer and matches the gate's own message instead.
"""

import json

import pytest

from conftest import (
    AUTHORIZED, ANY_PROMPT, hex_of, recipients, make_mandate, fund,
    mandate_state, FAR_EXPIRY,
)

DESC = "Purchase GPU compute for deploying Project Atlas."


@pytest.fixture
def funded(direct_vm, contract, chain_warp, principal, agent, recipient):
    make_mandate(direct_vm, contract, principal, agent, recipient)
    fund(direct_vm, contract, principal, 1, 100)
    return 1


def act(vm, contract, sender, *, to, amount=20, description=DESC, mandate=1):
    vm.sender = sender
    contract.request_action(mandate, hex_of(to), amount, description)


class WhoMaySpend:
    pass


def test_only_the_agent_may_request(direct_vm, contract, funded, principal,
                                    recipient, outsider):
    """The one gate here that arms a model answer first, and deliberately.

    Left unarmed, a removed caller check would send the request on to
    `exec_prompt`, which raises for its own unrelated reason -- the test would
    still pass while the gate was gone. With an answer armed and the gate's own
    message matched, nothing but the gate can produce this failure.
    """
    direct_vm.mock_llm(ANY_PROMPT, AUTHORIZED)
    try:
        for who in (principal, outsider):
            with pytest.raises(Exception, match="Registered agent only"):
                act(direct_vm, contract, who, to=recipient)
    finally:
        direct_vm.clear_mocks()


def test_the_agent_cannot_pay_itself_at_request_time(
    direct_vm, contract, funded, agent
):
    """The second half of the agent-recipient rule, and the message pins it.

    Creation already refuses an agent-as-recipient mandate, so no allowlisted
    address can ever be the agent and this guard is defence in depth. It is
    still the guard that answers first: delete it and the request falls through
    to the allowlist check, which refuses the same call for an unrelated
    reason. Matching this message is the only thing that tells the two apart --
    with a bare `raises(Exception)` the check can be removed unnoticed.
    """
    with pytest.raises(Exception, match="Agent cannot pay itself"):
        act(direct_vm, contract, agent, to=agent)


def test_the_recipient_must_be_on_the_allowlist(
    direct_vm, contract, funded, agent, outsider
):
    with pytest.raises(Exception, match="ecipient"):
        act(direct_vm, contract, agent, to=outsider)


def test_the_agent_cannot_be_listed_as_a_recipient(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    """Refused at creation, so an agent-pays-itself mandate cannot exist.

    `request_action` carries the same check a second time; that one is defence
    in depth and is unreachable while this one holds.
    """
    direct_vm.sender = principal
    with pytest.raises(Exception, match="Agent cannot be recipient"):
        contract.create_mandate(
            hex_of(agent), "Purchase cloud infrastructure.",
            recipients((recipient, "hosting"), (agent, "itself")),
            100, 30, 4, FAR_EXPIRY,
        )


def test_a_duplicate_recipient_is_refused(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    direct_vm.sender = principal
    with pytest.raises(Exception, match="Duplicate recipient"):
        contract.create_mandate(
            hex_of(agent), "Purchase cloud infrastructure.",
            recipients((recipient, "hosting"), (recipient, "hosting again")),
            100, 30, 4, FAR_EXPIRY,
        )


def test_the_per_action_cap_cannot_exceed_the_budget(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    """A cap above the budget would be a promise the budget cannot keep."""
    direct_vm.sender = principal
    with pytest.raises(Exception, match="cannot exceed total budget"):
        contract.create_mandate(
            hex_of(agent), "Purchase cloud infrastructure.",
            recipients((recipient, "hosting")),
            40, 100, 4, FAR_EXPIRY,
        )


class HowMuch:
    pass


def test_a_non_positive_amount_is_refused(direct_vm, contract, funded, agent,
                                          recipient):
    for amount in (0, -5):
        with pytest.raises(Exception, match="greater than zero"):
            act(direct_vm, contract, agent, to=recipient, amount=amount)


def test_the_per_action_cap_holds(direct_vm, contract, funded, agent,
                                  recipient):
    with pytest.raises(Exception, match="per-action cap"):
        act(direct_vm, contract, agent, to=recipient, amount=31)


def test_the_remaining_budget_holds_after_a_spend(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    """Budget is the ceiling across the mandate's whole life, not per action.

    Reaching this gate needs one action to have executed first, so a model
    answer is armed for that step and cleared before the step under test.
    """
    make_mandate(direct_vm, contract, principal, agent, recipient,
                 budget=40, cap=40)
    fund(direct_vm, contract, principal, 1, 40)

    direct_vm.mock_llm(ANY_PROMPT, AUTHORIZED)
    act(direct_vm, contract, agent, to=recipient, amount=30)
    assert mandate_state(contract)["spent"] == 30
    direct_vm.clear_mocks()

    # 20 is within the 40 cap but beyond the 10 of budget still unspent.
    with pytest.raises(Exception, match="remaining budget"):
        act(direct_vm, contract, agent, to=recipient, amount=20)


def test_the_funded_balance_holds(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    """Budget is a promise; funded is the money actually there."""
    make_mandate(direct_vm, contract, principal, agent, recipient,
                 budget=100, cap=100)
    fund(direct_vm, contract, principal, 1, 10)
    with pytest.raises(Exception, match="funded balance"):
        act(direct_vm, contract, agent, to=recipient, amount=50)


class TheDescription:
    pass


def test_an_empty_description_is_refused(direct_vm, contract, funded, agent,
                                         recipient):
    with pytest.raises(Exception, match="Description required"):
        act(direct_vm, contract, agent, to=recipient, description="   ")


def test_an_oversized_description_is_refused(direct_vm, contract, funded,
                                             agent, recipient):
    with pytest.raises(Exception):
        act(direct_vm, contract, agent, to=recipient, description="x" * 601)


class TheMandateItself:
    pass


def test_an_unknown_mandate_is_refused(direct_vm, contract, funded, agent,
                                       recipient):
    with pytest.raises(Exception):
        act(direct_vm, contract, agent, to=recipient, mandate=99)


def test_a_revoked_mandate_stops_accepting_requests(
    direct_vm, contract, funded, principal, agent, recipient
):
    direct_vm.sender = principal
    contract.revoke_mandate(1)
    with pytest.raises(Exception):
        act(direct_vm, contract, agent, to=recipient)


def test_an_expired_mandate_stops_accepting_requests(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    expiry = 1_780_400_000
    make_mandate(direct_vm, contract, principal, agent, recipient,
                 expires=expiry)
    fund(direct_vm, contract, principal, 1, 100)

    chain_warp("2027-01-01T00:00:00.000000Z")
    assert mandate_state(contract)["derived_status"] != "ACTIVE"
    with pytest.raises(Exception):
        act(direct_vm, contract, agent, to=recipient)


def test_an_unfunded_mandate_cannot_spend(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    make_mandate(direct_vm, contract, principal, agent, recipient)
    with pytest.raises(Exception, match="funded balance"):
        act(direct_vm, contract, agent, to=recipient)


def test_funding_beyond_the_budget_is_refused(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    """The budget is a ceiling on the money too, not just on the spending."""
    make_mandate(direct_vm, contract, principal, agent, recipient, budget=100)
    with pytest.raises(Exception, match="exceeds mandate budget"):
        fund(direct_vm, contract, principal, 1, 101)


def test_only_the_principal_may_fund(
    direct_vm, contract, chain_warp, principal, agent, recipient, outsider
):
    make_mandate(direct_vm, contract, principal, agent, recipient)
    for who in (agent, outsider):
        with pytest.raises(Exception):
            fund(direct_vm, contract, who, 1, 10)
