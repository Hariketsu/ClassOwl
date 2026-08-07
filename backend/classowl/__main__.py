from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

import ortools
import uvicorn
from ortools.sat.python import cp_model

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from classowl.app import create_app


TOKEN_ENV_VAR = "CLASSOWL_TOKEN"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    return parser.parse_args()


def read_token() -> str:
    token = os.environ.pop(TOKEN_ENV_VAR, "")
    if not token:
        raise SystemExit(f"缺少 {TOKEN_ENV_VAR} 环境变量，拒绝启动。")
    return token


def configure_logging(data_dir: Path) -> None:
    log_dir = data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stderr),
            logging.FileHandler(log_dir / "backend.log", encoding="utf-8"),
        ],
        force=True,
    )


def main() -> None:
    args = parse_args()
    token = read_token()
    data_dir = args.data_dir.expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    configure_logging(data_dir)
    logging.getLogger(__name__).info(
        "OR-Tools CP-SAT loaded: %s (%s)",
        ortools.__version__,
        cp_model.__name__,
    )
    app = create_app(token, data_dir)
    server = uvicorn.Server(
        uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=args.port,
            log_config=None,
        )
    )
    app.state.server = server
    server.run()


if __name__ == "__main__":
    main()
