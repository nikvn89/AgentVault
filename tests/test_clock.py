"""
The contract clock — the part most GenLayer contracts get wrong.

`_chain_unix()` converts `gl.message_raw["datetime"]` — the timestamp committed
with the transaction, which every node agrees on — into a unix integer using
pure arithmetic. No `time.time()`, no `datetime` module, nothing that could
return a different answer on a different machine. Every expiry decision in the
contract rests on it.

Pure arithmetic is exactly the kind of code that is easy to get subtly wrong and
easy to test exhaustively, so this file does both: a fuzz over more than twelve
thousand dates against Python's own calendar, and the malformed-input paths.
"""

import calendar
import json
import random

import pytest

from conftest import iso


def chain_unix(contract) -> int:
    return json.loads(contract.get_chain_time())["unix"]


class Correctness:
    pass


def test_matches_python_across_twelve_thousand_dates(
    direct_vm, contract, chain_warp
):
    """Every day from 1970 to 2070, plus a random time of day on each."""
    rng = random.Random(20260908)
    checked = 0

    for year in range(1970, 2071):
        for month in range(1, 13):
            day = rng.randint(1, calendar.monthrange(year, month)[1])
            hour = rng.randint(0, 23)
            minute = rng.randint(0, 59)
            second = rng.randint(0, 59)

            chain_warp(iso(year, month, day, hour, minute, second))
            expected = calendar.timegm(
                (year, month, day, hour, minute, second, 0, 0, 0)
            )
            assert chain_unix(contract) == expected, (
                f"{year}-{month:02d}-{day:02d} {hour}:{minute}:{second}"
            )
            checked += 1

    assert checked == 101 * 12


def test_leap_day_boundaries(direct_vm, contract, chain_warp):
    """The dates a hand-rolled civil-date conversion usually breaks on."""
    for year, month, day in [
        (2000, 2, 29),   # divisible by 400 — is a leap year
        (1900, 3, 1),    # divisible by 100, not 400 — is not
        (2024, 2, 29),
        (2026, 3, 1),
        (2100, 3, 1),    # not a leap year
        (2400, 2, 29),   # is one
    ]:
        chain_warp(iso(year, month, day, 12, 0, 0))
        assert chain_unix(contract) == calendar.timegm(
            (year, month, day, 12, 0, 0, 0, 0, 0)
        ), f"{year}-{month:02d}-{day:02d}"


def test_year_and_day_boundaries(direct_vm, contract, chain_warp):
    for stamp, parts in [
        (iso(2026, 1, 1, 0, 0, 0), (2026, 1, 1, 0, 0, 0)),
        (iso(2026, 12, 31, 23, 59, 59), (2026, 12, 31, 23, 59, 59)),
        (iso(1970, 1, 1, 0, 0, 0), (1970, 1, 1, 0, 0, 0)),
    ]:
        chain_warp(stamp)
        assert chain_unix(contract) == calendar.timegm(parts + (0, 0, 0))


def test_the_epoch_is_zero(direct_vm, contract, chain_warp):
    chain_warp(iso(1970, 1, 1, 0, 0, 0))
    assert chain_unix(contract) == 0


class Malformed:
    pass


@pytest.mark.parametrize("stamp", [
    "",
    "2026-06-01",
    "not-a-timestamp-at-all",
    "2026-13-01T00:00:00Z",   # month 13
    "2026-06-32T00:00:00Z",   # day 32
    "2026-06-01T24:00:00Z",   # hour 24
    "2026-06-01T00:60:00Z",   # minute 60
    "2026-06-01T00:00:60Z",   # second 60
    "20xx-06-01T00:00:00Z",   # non-numeric year
])
def test_a_malformed_chain_datetime_is_refused(
    direct_vm, contract, chain_warp, stamp
):
    """Fail closed. A clock that cannot be read must not become a default."""
    chain_warp(stamp)
    with pytest.raises(Exception):
        contract.get_chain_time()


def test_a_truncated_timestamp_is_refused_on_length_alone(
    direct_vm, contract, chain_warp
):
    """The only defect here is that the string is too short.

    "2026-06-01T12:00:0" parses field by field without complaint -- every
    numeric slice it yields is in range, and the seconds slice reads "0". The
    length guard is the only thing standing between a truncated stamp and a
    silently accepted time, so it needs a case of its own.
    """
    chain_warp("2026-06-01T12:00:0")
    with pytest.raises(Exception, match="Invalid chain datetime"):
        contract.get_chain_time()


def test_a_valid_timestamp_without_the_z_suffix_still_parses(
    direct_vm, contract, chain_warp
):
    """The parser reads fixed offsets, so the suffix is not load-bearing."""
    chain_warp("2026-06-01T12:00:00")
    assert chain_unix(contract) == calendar.timegm(
        (2026, 6, 1, 12, 0, 0, 0, 0, 0)
    )
