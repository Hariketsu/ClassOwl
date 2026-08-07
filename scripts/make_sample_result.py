#!/usr/bin/env python3
"""重新生成内置示例方案的预排课结果 fixture。

用法（仓库根目录）：

    uv run python scripts/make_sample_result.py [--seconds 120]

用真实 CP-SAT 求解器对 `classowl.sample.sample_workspace()` 排一次课，
把得到的 placements 以 Python 字面量形式写回
`backend/classowl/sample_result.py`（整体覆盖）。

求解器升级或示例数据调整后重跑一次即可刷新 fixture。
脚本会拒绝写入带硬冲突的结果（park 非空或存在非 soft 的未满足项），
保证示例方案始终是一份「零硬冲突」的成品课表。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from ortools import __version__ as ortools_version  # noqa: E402

from classowl.sample import sample_workspace  # noqa: E402
from classowl.solver import SolverJob, SolverService  # noqa: E402

OUTPUT = ROOT / "backend" / "classowl" / "sample_result.py"


def solve_sample(seconds: int) -> list[dict]:
    document = sample_workspace("示例方案").model_dump(
        mode="json", exclude_none=True
    )
    job = SolverJob(id="sample-fixture", plan_id="sample-fixture")
    # _solve 只读 document 字典，不触库，store 传 None 即可。
    SolverService(store=None)._solve(  # type: ignore[arg-type]
        job, document, seconds=seconds, keep_existing=False
    )
    if job.status != "done" or job.result is None:
        raise SystemExit(f"求解失败：{job.status} {job.message}")
    result = job.result
    total_hours = sum(
        cell["hours"]
        for row in document["matrix"].values()
        for cell in row.values()
    )
    placements = result["placements"]
    if result["park"]:
        raise SystemExit(f"存在未排课时，拒绝固化：{result['park']}")
    hard_unmet = [u for u in result["unmet"] if not u.get("soft")]
    if hard_unmet:
        raise SystemExit(f"存在硬冲突，拒绝固化：{hard_unmet}")
    if len(placements) != total_hours:
        raise SystemExit(
            f"placements 数 {len(placements)} 与课时总量 {total_hours} 不符"
        )
    for entry in result["unmet"]:
        print(f"提示（soft，可接受）：{entry['text']}")
    placements.sort(
        key=lambda p: (p["classId"], p["dayId"], p["periodId"], p["courseId"])
    )
    for index, placement in enumerate(placements, start=1):
        placement["id"] = f"p-s{index:03d}"
    return placements


def render(placements: list[dict], seconds: int) -> str:
    lines = [
        '"""内置示例方案的预排课结果（固化 fixture）。',
        "",
        "本文件由脚本生成，请勿手工编辑。重新生成：",
        "",
        "    uv run python scripts/make_sample_result.py",
        "",
        f"当前数据由 OR-Tools {ortools_version} CP-SAT 求解 "
        f"{seconds} 秒得到；placements 已按 (classId, dayId, periodId) 排序，",
        "id 重编为 p-sNNN 以保证重复生成时 diff 稳定。",
        '"""',
        "",
        "from __future__ import annotations",
        "",
        "SAMPLE_PLACEMENTS: list[dict] = [",
    ]
    for placement in placements:
        lines.append(f"    {placement!r},")
    lines.append("]")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--seconds",
        type=int,
        default=120,
        help="求解时间上限（秒），默认 120",
    )
    args = parser.parse_args()
    placements = solve_sample(args.seconds)
    OUTPUT.write_text(render(placements, args.seconds), encoding="utf-8")
    print(f"已写入 {OUTPUT}：{len(placements)} 条 placements")


if __name__ == "__main__":
    main()
