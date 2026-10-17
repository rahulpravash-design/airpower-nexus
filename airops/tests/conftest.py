import pytest

from airops.core.config import load_config
from airops.generator.scenario import generate_scenario
from airops.solver.plan import generate_plan


@pytest.fixture(scope="session")
def cfg():
    return load_config()


@pytest.fixture(scope="session")
def scn(cfg):
    return generate_scenario(26250, cfg)


@pytest.fixture(scope="session")
def greedy_plan(scn, cfg):
    return generate_plan(scn, cfg, method="GREEDY", plan_id="t-greedy")


@pytest.fixture(scope="session")
def base_plan(scn, cfg):
    """A real CP-SAT baseline plan (3 s limit keeps the suite fast)."""
    return generate_plan(scn, cfg, method="CP_SAT", plan_id="t-base", time_limit=3)
