"""
Mandate lifecycle: creation limits, funding, revocation, withdrawal, expiry.

The principal's protections live here. A mandate is immutable once created —
the agent, the text, the recipient set, the budget, the cap, the action limit
and the expiry are all fixed — so the only levers left are revoke and withdraw,
and both belong to the principal alone.
"""

import json

import pytest

from conftest import (
    AUTHORIZED, ANY_PROMPT, hex_of, recipients, make_mandate, fund,
    mandate_state, FAR_EXPIRY,
)

DESC = "Purchase GPU compute for deploying Project Atlas."


class Creation:
    pass


def test_the_agent_cannot_be_the_principal(
    direct_vm, contract, chain_warp, principal, recipient
):
    direct_vm.sender = principal
    with pytest.raises(Exception, match="Agent must differ from principal"):
        contract.create_mandate(
            hex_of(principal), "Purchase cloud infrastructure.",
            recipients((recipient, "hosting")), 100, 30, 4, FAR_EXPIRY,
        )


def test_an_empty_mandate_text_is_refused(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    direct_vm.sender = principal
    with pytest.raises(Exception):
        contract.create_mandate(
            hex_of(agent), "   ", recipients((recipient, "hosting")),
            100, 30, 4, FAR_EXPIRY,
        )


def test_an_oversized_mandate_text_is_refused(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    direct_vm.sender = principal
    with pytest.raises(Exception):
        contract.create_mandate(
            hex_of(agent), "x" * 2001, recipients((recipient, "hosting")),
            100, 30, 4, FAR_EXPIRY,
        )


def test_at_least_one_recipient_is_required(
    direct_vm, contract, chain_warp, principal, agent
):
    """The allowlist is what makes recipient-role coherence checkable."""
    direct_vm.sender = principal
    with pytest.raises(Exception):
        contract.create_mandate(
            hex_of(agent), "Purchase cloud infrastructure.", "[]",
            100, 30, 4, FAR_EXPIRY,
        )


def test_a_recipient_needs_a_label(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    """A bare address gives the model nothing to judge coherence against."""
    direct_vm.sender = principal
    with pytest.raises(Exception, match="label"):
        contract.create_mandate(
            hex_of(agent), "Purchase cloud infrastructure.",
            json.dumps([{"address": hex_of(recipient), "label": "  "}]),
            100, 30, 4, FAR_EXPIRY,
        )


@pytest.mark.parametrize("budget,cap,actions,message", [
    (0, 30, 4, "Total budget must be greater than zero"),
    (100, 0, 4, "Per-action cap must be greater than zero"),
    (100, 30, 0, "Max actions must be greater than zero"),
])
def test_a_non_positive_budget_or_cap_or_action_limit_is_refused(
    direct_vm, contract, chain_warp, principal, agent, recipient,
    budget, cap, actions, message
):
    """Each case matches its own message, which is the point of splitting them.

    A shared `pytest.raises(Exception)` over all three passed even with the
    budget check deleted: a budget of zero then fell through to
    `per_action_cap > total_budget`, which refused it for an unrelated reason.
    Matching the message pins each case to the guard it is meant to exercise.
    """
    direct_vm.sender = principal
    allow = recipients((recipient, "hosting"))
    with pytest.raises(Exception, match=message):
        contract.create_mandate(
            hex_of(agent), "Purchase cloud infrastructure.", allow,
            budget, cap, actions, FAR_EXPIRY,
        )


def test_a_principal_is_capped_at_ten_active_mandates(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    for _ in range(10):
        make_mandate(direct_vm, contract, principal, agent, recipient)
    with pytest.raises(Exception):
        make_mandate(direct_vm, contract, principal, agent, recipient)


def test_revoking_frees_a_slot(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    for _ in range(10):
        make_mandate(direct_vm, contract, principal, agent, recipient)
    direct_vm.sender = principal
    contract.revoke_mandate(1)
    make_mandate(direct_vm, contract, principal, agent, recipient)
    assert json.loads(contract.get_mandate_count())["mandate_count"] == 11


class RevokeAndWithdraw:
    pass


@pytest.fixture
def funded(direct_vm, contract, chain_warp, principal, agent, recipient):
    make_mandate(direct_vm, contract, principal, agent, recipient)
    fund(direct_vm, contract, principal, 1, 100)
    return 1


def test_only_the_principal_may_revoke(
    direct_vm, contract, funded, agent, outsider
):
    for who in (agent, outsider):
        direct_vm.sender = who
        with pytest.raises(Exception):
            contract.revoke_mandate(1)


def test_revoking_twice_is_refused(direct_vm, contract, funded, principal):
    direct_vm.sender = principal
    contract.revoke_mandate(1)
    with pytest.raises(Exception):
        contract.revoke_mandate(1)


def test_only_the_principal_may_withdraw(
    direct_vm, contract, funded, agent, outsider
):
    for who in (agent, outsider):
        direct_vm.sender = who
        with pytest.raises(Exception):
            contract.withdraw_unused(1)


def test_the_principal_can_recover_the_unspent_balance(
    direct_vm, contract, funded, principal, agent, recipient
):
    """The escape hatch the README promises a reviewer."""
    direct_vm.mock_llm(ANY_PROMPT, AUTHORIZED)
    direct_vm.sender = agent
    contract.request_action(1, hex_of(recipient), 20, DESC)
    direct_vm.clear_mocks()

    assert mandate_state(contract)["available_funded"] == 80

    direct_vm.sender = principal
    contract.revoke_mandate(1)
    contract.withdraw_unused(1)

    # The 80 that was never spent is no longer held against the mandate.
    assert mandate_state(contract)["available_funded"] == 0
    assert mandate_state(contract)["spent"] == 20


def test_withdrawing_nothing_is_refused(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    make_mandate(direct_vm, contract, principal, agent, recipient)
    direct_vm.sender = principal
    contract.revoke_mandate(1)
    with pytest.raises(Exception):
        contract.withdraw_unused(1)


class Views:
    pass


def test_the_registry_limits_are_reported(direct_vm, contract, chain_warp):
    limits = json.loads(contract.get_registry_limits())
    assert limits["max_active_mandates_per_principal"] == 10
    assert limits["max_registry_mandates"] == 50
    assert limits["max_recipients_per_mandate"] == 20
    assert limits["max_actions_per_mandate"] == 50


def test_mandates_are_listed_by_principal_and_by_agent(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    make_mandate(direct_vm, contract, principal, agent, recipient)
    by_principal = json.loads(
        contract.get_principal_mandates(hex_of(principal)))
    by_agent = json.loads(contract.get_agent_mandates(hex_of(agent)))
    assert [int(x) for x in by_principal] == [1]
    assert [int(x) for x in by_agent] == [1]


def test_an_unknown_mandate_is_refused(direct_vm, contract, chain_warp):
    """Reading a mandate that does not exist reverts rather than returning {}."""
    with pytest.raises(Exception, match="Mandate not found"):
        contract.get_mandate(999)
