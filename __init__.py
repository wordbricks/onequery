"""Hermes plugin entrypoint for installs from the OneQuery repository root."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_impl():
    plugin_root = Path(__file__).resolve().parent / "packages" / "hermes-plugin"
    package_root = plugin_root / "onequery_hermes_plugin"
    init_file = package_root / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "onequery_hermes_plugin_impl",
        init_file,
        submodule_search_locations=[str(package_root)],
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load OneQuery Hermes plugin from {init_file}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_impl = _load_impl()
register = _impl.register

