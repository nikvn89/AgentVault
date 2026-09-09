"""
What the contract does with a verdict — and what it refuses to let a verdict do.

Consensus answers one question: does the described purpose fall inside the
mandate the principal wrote? It never chooses an amount, a recipient or a
budget. These tests arm an answer through `mock_llm`, let the contract's own
leader and validator functions run on real GenVM, and check the state that
results.

One design decision is worth naming because it is unusual and deliberate: a
**DENIED request still consumes an action slot**. Without that, an agent could
re-describe the same spend indefinitely until a verdict came back favourable.
The action counter is what bounds those attempts, so it has to advance on
refusal too.
"""

import json

import pytest

from conftest import (
    AUTHORIZED, DENIED, ANY_PROMPT, hex_of, make_mandate, fund,
    mandate_state, request_state,
)

DESC = "Purchase GPU compute for deploying Project Atlas."
OFF_SCOPE = "Purchase personal gaming equipment unrelated to Project Atlas."


@pytest.fixture
def funded(direct_vm, contract, chain_warp, principal, agent, recipient):
    make_mandate(direct_vm, contract, principal, agent, recipient)
    fund(direct_vm, contract, principal, 1, 100)
    return 1


def act(vm, contract, agent, recipient, *, amount=20, description=DESC):
    vm.sender = agent
    contract.request_action(1, hex_of(recipient), amount, description)


def test_an_authorized_verdict_spends_and_records(
    direct_vm, contract, funded, agent, recipient
):
    direct_vm.mock_llm(ANY_PROMPT, AUTHORIZED)
    act(direct_vm, contract, agent, recipient, amount=20)

    mandate = mandate_state(contract)
    assert mandate["spent"] == 20
    assert mandate["actions_used"] == 1
    assert mandate["remaining_budget"] == 80

    request = request_state(contract)
    assert request["decision"] == "AUTHORIZED"
    assert request["status"] == "EXECUTED"
    assert int(request["amount"]) == 20


def test_a_denied_verdict_moves_no_money(
    direct_vm, contract, funded, agent, recipient
):
    direct_vm.mock_llm(ANY_PROMPT, DENIED)
    act(direct_vm, contract, agent, recipient, description=OFF_SCOPE)

    mandate = mandate_state(contract)
    assert mandate["spent"] == 0
    assert mandate["remaining_budget"] == 100

    request = request_state(contract)
    assert request["decision"] == "DENIED"
    assert request["status"] == "DENIED"


def test_a_denied_verdict_still_consumes_an_action_slot(
    direct_vm, contract, funded, agent, recipient
):
    """The anti-grinding rule. Refusals are counted, or they are free."""
    direct_vm.mock_llm(ANY_PROMPT, DENIED)
    act(direct_vm, contract, agent, recipient, description=OFF_SCOPE)
    assert mandate_state(contract)["actions_used"] == 1


def test_the_action_limit_is_reached_by_refusals_alone(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    """Four refusals exhaust a four-action mandate. Nothing was spent."""
    make_mandate(direct_vm, contract, principal, agent, recipient,
                 max_actions=4)
    fund(direct_vm, contract, principal, 1, 100)

    direct_vm.mock_llm(ANY_PROMPT, DENIED)
    for _ in range(4):
        act(direct_vm, contract, agent, recipient, description=OFF_SCOPE)

    mandate = mandate_state(contract)
    assert mandate["actions_used"] == 4
    assert mandate["spent"] == 0

    with pytest.raises(Exception):
        act(direct_vm, contract, agent, recipient, description=OFF_SCOPE)


def test_a_malformed_model_answer_does_not_authorize(
    direct_vm, contract, funded, agent, recipient
):
    """Anything that is not a clean AUTHORIZED must not move money."""
    direct_vm.mock_llm(ANY_PROMPT, "looks fine to me")
    try:
        act(direct_vm, contract, agent, recipient)
    except Exception:
        pass  # reverting is an acceptable outcome; authorizing is not

    assert mandate_state(contract)["spent"] == 0


def test_an_unknown_decision_word_does_not_authorize(
    direct_vm, contract, funded, agent, recipient
):
    direct_vm.mock_llm(ANY_PROMPT, json.dumps({
        "decision": "MAYBE", "failed_check": 0, "reason": "unsure",
    }))
    try:
        act(direct_vm, contract, agent, recipient)
    except Exception:
        pass

    assert mandate_state(contract)["spent"] == 0


def test_the_validator_accepts_a_leader_it_reproduces(
    direct_vm, contract, funded, agent, recipient
):
    direct_vm.mock_llm(ANY_PROMPT, AUTHORIZED)
    act(direct_vm, contract, agent, recipient)
    assert direct_vm.run_validator(
        leader_result={"decision": "AUTHORIZED", "failed_check": 0,
                       "reason": "within scope"}
    ) is True


def test_the_validator_rejects_a_leader_it_does_not_reproduce(
    direct_vm, contract, funded, agent, recipient
):
    """The validator's own model disagrees, so there is no consensus."""
    direct_vm.mock_llm(ANY_PROMPT, AUTHORIZED)
    act(direct_vm, contract, agent, recipient)

    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, DENIED)
    assert direct_vm.run_validator(
        leader_result={"decision": "AUTHORIZED", "failed_check": 0,
                       "reason": "within scope"}
    ) is False


def test_the_mandate_text_reaches_the_prompt(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    """The model is asked about the principal's actual words."""
    make_mandate(direct_vm, contract, principal, agent, recipient,
                 text="Purchase cloud infrastructure for Project Halibut.")
    fund(direct_vm, contract, principal, 1, 100)

    # The mock only fires if the prompt really carries the mandate text.
    direct_vm.mock_llm(r"Project Halibut", AUTHORIZED)
    act(direct_vm, contract, agent, recipient)
    assert mandate_state(contract)["spent"] == 20


def test_the_recipient_label_reaches_the_prompt(
    direct_vm, contract, chain_warp, principal, agent, recipient
):
    """Recipient-role coherence is only checkable if the label is there."""
    make_mandate(direct_vm, contract, principal, agent, recipient,
                 label="Antarctic penguin photography studio")
    fund(direct_vm, contract, principal, 1, 100)

    direct_vm.mock_llm(r"Antarctic penguin photography studio", AUTHORIZED)
    act(direct_vm, contract, agent, recipient)
    assert mandate_state(contract)["spent"] == 20
