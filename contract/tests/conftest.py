from pathlib import Path
from unittest.mock import patch

import pytest
from genvm_linter.validate.artifacts import download_artifacts
from gltest.direct import VMContext, deploy_contract, sdk_loader

SOURCE = Path(__file__).resolve().parents[1] / "contracts" / "spec_lock.py"


@pytest.fixture(scope="session")
def initial_contract():
    vm = VMContext()
    with vm.activate():
        with patch.object(sdk_loader, "download_artifacts", download_artifacts):
            contract = deploy_contract(SOURCE, vm, sdk_version="v0.3.0-rc7")
        yield vm, contract, vm.snapshot()


@pytest.fixture
def spec_lock(initial_contract):
    vm, contract, baseline = initial_contract
    vm.revert(baseline)
    vm.sender = "0x" + "11" * 20
    vm.warp("2026-11-14T00:00:00+00:00")
    return vm, contract
