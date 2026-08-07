from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from classowl.app import create_app


TOKEN = "test-token"


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(TOKEN, tmp_path)) as test_client:
        test_client.headers["X-ClassOwl-Token"] = TOKEN
        yield test_client


def workspace(*, hours: int = 2) -> dict:
    return {
        "schemeName": "求解测试",
        "days": [{"id": 1, "label": "星期一", "short": "一"}],
        "periods": [
            {
                "id": period_id,
                "label": f"{period_id}节",
                "band": "上午",
                "start": f"0{7 + period_id}:00",
                "end": f"0{7 + period_id}:40",
            }
            for period_id in range(1, 6)
        ],
        "teachers": [{"id": "t1", "name": "王老师"}],
        "classes": [
            {"id": "c1", "grade": "一年级", "name": "1班", "room": "101"}
        ],
        "courses": [{"id": "k1", "name": "语文", "biweekly": False}],
        "gradeCourses": {"一年级": ["k1"]},
        "matrix": {"c1": {"k1": {"hours": hours, "teacherId": "t1"}}},
        "linked": [],
        "biweekly": [],
        "combined": [],
        "layered": [],
        "venues": [],
        "rules": [],
        "placements": [],
        "park": [],
        "scheduleStatus": "empty",
    }


def create_plan_with_document(client: TestClient, document: dict) -> str:
    plan = client.post("/api/v1/plans").json()
    response = client.put(
        f"/api/v1/plans/{plan['id']}/doc",
        json={"baseRev": 0, "doc": document, "checkpoint": None},
    )
    assert response.status_code == 200, response.text
    return plan["id"]


def wait_for_terminal(client: TestClient, job_id: str) -> dict:
    for _ in range(200):
        job = client.get(f"/api/v1/solver/{job_id}").json()
        if job["status"] not in {"queued", "running"}:
            return job
        time.sleep(0.01)
    pytest.fail("求解任务未在时限内结束")


def solve(
    client: TestClient, document: dict, *, keep_existing: bool = False
) -> dict:
    plan_id = create_plan_with_document(client, document)
    request = {"timeLimitSeconds": 1}
    if keep_existing:
        request["keepExisting"] = True
    started = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json=request,
    )
    return wait_for_terminal(client, started.json()["jobId"])


def rule(rule_type: str, **fields) -> dict:
    return {
        "id": "r1",
        "type": rule_type,
        "enabled": True,
        "note": "",
        "summary": "",
        **fields,
    }


def add_second_class(
    document: dict, *, course_id: str = "k1", teacher_id: str = "t2"
) -> None:
    document["teachers"].append({"id": teacher_id, "name": "李老师"})
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["matrix"]["c2"] = {
        course_id: {"hours": 1, "teacherId": teacher_id}
    }


def placement(placement_id: str, period_id: int) -> dict:
    return {
        "id": placement_id,
        "classId": "c1",
        "courseId": "k1",
        "teacherId": "t1",
        "dayId": 1,
        "periodId": period_id,
        "source": "manual",
        "locked": False,
    }


def make_solver_infeasible(document: dict) -> None:
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    document["matrix"]["c1"]["k2"] = {"hours": 1, "teacherId": "t1"}
    document["placements"] = [
        {**placement("p1", 1), "locked": True},
        {
            **placement("p2", 1),
            "courseId": "k2",
            "locked": True,
        },
    ]


def demo_workspace() -> dict:
    document = workspace()
    document["days"] = [
        {"id": day_id, "label": f"星期{'一二三四五'[day_id - 1]}", "short": "一二三四五"[day_id - 1]}
        for day_id in range(1, 6)
    ]
    document["periods"] = [
        {
            "id": period_id,
            "label": f"{period_id}节",
            "band": "上午" if period_id <= 4 else "下午",
            "start": f"{7 + period_id:02d}:00",
            "end": f"{7 + period_id:02d}:40",
        }
        for period_id in range(1, 7)
    ]
    teacher_names = [
        "王芳", "李强", "陈静", "赵磊", "周敏",
        "孙悦", "马超", "林雪", "何平", "郑凯",
    ]
    document["teachers"] = [
        {"id": f"t{index}", "name": name}
        for index, name in enumerate(teacher_names, 1)
    ]
    document["classes"] = [
        {"id": "c1", "grade": "一年级", "name": "1班", "room": "101"},
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"},
        {"id": "c3", "grade": "一年级", "name": "3班", "room": "103"},
        {"id": "c4", "grade": "二年级", "name": "1班", "room": "201"},
        {"id": "c5", "grade": "二年级", "name": "2班", "room": "202"},
    ]
    course_names = {
        "k1": "班会", "k2": "写字", "k3": "语文", "k4": "数学",
        "k5": "道德与法治", "k6": "体育与健康", "k7": "音乐",
        "k8": "美术", "k9": "少先队活动", "k10": "劳动教育",
        "k11": "红色文化", "k12": "数学测试", "k13": "科学",
    }
    document["courses"] = [
        {"id": course_id, "name": name, "biweekly": False}
        for course_id, name in course_names.items()
    ]
    g1_hours = {
        "k1": 0, "k2": 1, "k3": 8, "k4": 4, "k5": 2, "k6": 2,
        "k7": 1, "k8": 1, "k9": 1, "k10": 1, "k11": 1, "k12": 3,
    }
    g1_teachers = {
        "k1": "t1", "k2": "t1", "k3": "t1", "k4": "t2",
        "k5": "t3", "k6": "t4", "k7": "t5", "k8": "t6",
        "k9": "t1", "k10": "t7", "k11": "t7", "k12": "t2",
    }
    g2_hours = {
        "k1": 0, "k2": 1, "k3": 8, "k4": 4, "k13": 1, "k5": 1,
        "k6": 2, "k7": 2, "k8": 2, "k9": 1, "k10": 1, "k11": 1,
    }
    g2_teachers = {
        "k1": "t8", "k2": "t8", "k3": "t8", "k4": "t9",
        "k13": "t10", "k5": "t3", "k6": "t4", "k7": "t5",
        "k8": "t6", "k9": "t8", "k10": "t7", "k11": "t7",
    }
    document["matrix"] = {
        school_class["id"]: {
            course_id: {
                "hours": hours,
                "teacherId": (
                    g1_teachers if school_class["grade"] == "一年级"
                    else g2_teachers
                )[course_id],
            }
            for course_id, hours in (
                g1_hours if school_class["grade"] == "一年级"
                else g2_hours
            ).items()
        }
        for school_class in document["classes"]
    }
    document["matrix"]["c1"]["k1"]["hours"] = 1
    document["matrix"]["c4"]["k1"]["hours"] = 1
    class_ids = [school_class["id"] for school_class in document["classes"]]
    document["gradeCourses"] = {
        "一年级": list(g1_hours),
        "二年级": list(g2_hours),
    }
    document["rules"] = [
        rule(
            "禁排",
            id="r1",
            subjectMode="course",
            courseIds=["k6"],
            classIds=class_ids,
            cells=[
                {"dayId": day_id, "periodId": 1}
                for day_id in range(1, 6)
            ],
        ),
        rule(
            "必排",
            id="r2",
            subjectMode="course",
            courseIds=["k1"],
            classIds=class_ids,
            cells=[{"dayId": 1, "periodId": 6}],
        ),
        rule(
            "课程优先排",
            id="r3",
            subjectMode="course",
            courseIds=["k3"],
            classIds=class_ids,
            periodIds=[1, 2, 3, 4],
        ),
        rule(
            "各天限制",
            id="r4",
            subjectMode="course",
            courseIds=["k3"],
            classIds=class_ids,
            dayIds=[1, 2, 3, 4, 5],
            limitType="最少",
            limitCount=1,
        ),
    ]
    return document


def test_relaxed_demo_workspace_with_four_rules_is_solvable(
    client: TestClient,
):
    job = solve(client, demo_workspace())

    assert job["status"] == "done"


def test_infeasible_reports_total_capacity_shortage(client: TestClient):
    document = workspace(hours=2)
    document["periods"] = document["periods"][:1]
    make_solver_infeasible(document)

    job = solve(client, document)

    assert job["status"] == "infeasible"
    assert any(
        "总课时需求 3 节超过总课位容量 1 节，缺少 2 个课位"
        in item["text"]
        and "增加节次或减少课时" in item["text"]
        for item in job["result"]["unmet"]
    )


def test_infeasible_reports_class_capacity_shortage(client: TestClient):
    document = workspace(hours=2)
    document["periods"] = document["periods"][:2]
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["matrix"]["c2"] = {}
    make_solver_infeasible(document)

    job = solve(client, document)

    assert job["status"] == "infeasible"
    assert any(
        "一年级1班课时需求 3 节超过可用课位 2 节，缺少 1 个课位"
        in item["text"]
        for item in job["result"]["unmet"]
    )


def test_infeasible_reports_teacher_capacity_shortage(client: TestClient):
    document = workspace(hours=2)
    document["periods"] = document["periods"][:2]
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["matrix"]["c2"] = {
        "k1": {"hours": 2, "teacherId": "t1"}
    }
    document["placements"] = [
        {**placement("p1", 1), "locked": True},
        {
            **placement("p2", 1),
            "classId": "c2",
            "locked": True,
        },
    ]

    job = solve(client, document)

    assert job["status"] == "infeasible"
    assert any(
        "王老师总课时 4 节超过教师可用课位 2 节，缺少 2 个课位"
        in item["text"]
        for item in job["result"]["unmet"]
    )


def test_infeasible_reports_conflicting_must_and_ban_rules(
    client: TestClient,
):
    document = workspace(hours=1)
    make_solver_infeasible(document)
    cell = {"dayId": 1, "periodId": 1}
    document["rules"] = [
        rule(
            "必排",
            id="r-must",
            note="固定语文",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[cell],
        ),
        rule(
            "禁排",
            id="r-ban",
            note="语文禁排",
            subjectMode="course",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[cell],
        ),
    ]

    job = solve(client, document)

    assert job["status"] == "infeasible"
    assert any(
        "必排规则「固定语文」与禁排规则「语文禁排」冲突"
        in item["text"]
        and "一年级1班「语文」" in item["text"]
        and "星期一第1节" in item["text"]
        for item in job["result"]["unmet"]
    )


def test_infeasible_reports_must_positions_over_course_hours(
    client: TestClient,
):
    document = workspace(hours=1)
    make_solver_infeasible(document)
    document["rules"] = [
        rule(
            "必排",
            note="语文固定位置",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[
                {"dayId": 1, "periodId": 1},
                {"dayId": 1, "periodId": 2},
            ],
        )
    ]

    job = solve(client, document)

    assert job["status"] == "infeasible"
    assert any(
        "一年级1班「语文」只有 1 课时，但设置了 2 个必排位置"
        in item["text"]
        and "减少必排位置或增加课时" in item["text"]
        for item in job["result"]["unmet"]
    )


def test_infeasible_warns_when_capacity_margin_is_too_tight(
    client: TestClient,
):
    document = workspace(hours=4)
    make_solver_infeasible(document)
    document["rules"] = [
        rule(
            "课程优先排",
            courseIds=["k1"],
            classIds=["c1"],
            periodIds=[1, 2],
        )
    ]

    job = solve(client, document)

    assert job["status"] == "infeasible"
    assert any(
        item.get("soft") is True
        and "课位余量 0/5（0.0%）不足，规则难以同时满足"
        in item["text"]
        for item in job["result"]["unmet"]
    )


def test_infeasible_without_known_cause_returns_actionable_fallback(
    client: TestClient,
):
    document = workspace(hours=1)
    make_solver_infeasible(document)

    job = solve(client, document)

    assert job["status"] == "infeasible"
    assert job["message"] == "未找到可行解"
    assert job["result"]["placements"] == []
    assert job["result"]["park"] == []
    assert job["result"]["unmet"] == [
        {"text": "条件组合无法同时满足，建议逐条停用条件后重试"}
    ]


def test_keep_existing_preserves_unlocked_lessons_and_fills_gap(
    client: TestClient,
):
    document = workspace(hours=4)
    document["placements"] = [placement("p1", 4), placement("p2", 5)]

    job = solve(client, document, keep_existing=True)
    placements = job["result"]["placements"]

    assert job["status"] == "done"
    assert {
        (item["id"], item["periodId"])
        for item in placements
        if item["id"] in {"p1", "p2"}
    } == {("p1", 4), ("p2", 5)}
    assert len(placements) == 4


def test_keep_existing_does_not_add_to_filled_course(client: TestClient):
    document = workspace(hours=2)
    document["placements"] = [placement("p1", 4), placement("p2", 5)]

    job = solve(client, document, keep_existing=True)

    assert job["status"] == "done"
    assert job["result"]["placements"] == document["placements"]


def test_default_solve_rearranges_unlocked_lessons(client: TestClient):
    document = workspace(hours=1)
    document["placements"] = [placement("p1", 5)]
    document["rules"] = [
        rule(
            "禁排",
            subjectMode="course",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[{"dayId": 1, "periodId": 5}],
        )
    ]

    job = solve(client, document)

    assert job["status"] == "done"
    assert all(item["id"] != "p1" for item in job["result"]["placements"])
    assert all(
        item["periodId"] != 5 for item in job["result"]["placements"]
    )


def test_keep_existing_preserves_banned_lesson_and_reports_it(
    client: TestClient,
):
    document = workspace(hours=1)
    document["placements"] = [placement("p1", 5)]
    document["rules"] = [
        rule(
            "禁排",
            subjectMode="course",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[{"dayId": 1, "periodId": 5}],
        )
    ]

    job = solve(client, document, keep_existing=True)

    assert job["status"] == "done"
    assert job["result"]["placements"] == document["placements"]
    assert any("禁排" in item["text"] for item in job["result"]["unmet"])


def test_keep_existing_preserves_excess_lessons_without_adding(
    client: TestClient,
):
    document = workspace(hours=1)
    document["placements"] = [placement("p1", 4), placement("p2", 5)]

    job = solve(client, document, keep_existing=True)

    assert job["status"] == "done"
    assert job["result"]["placements"] == document["placements"]
    assert not job["result"]["park"]


def test_solve_returns_job_and_eventually_finishes(client: TestClient):
    plan_id = create_plan_with_document(client, workspace())

    response = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json={"timeLimitSeconds": 1},
    )

    assert response.status_code == 202
    assert response.json()["jobId"]
    assert wait_for_terminal(client, response.json()["jobId"])["status"] == "done"


def test_each_teaching_task_is_filled_to_its_matrix_hours(
    client: TestClient,
):
    document = workspace(hours=3)
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    document["matrix"]["c1"]["k2"] = {"hours": 2, "teacherId": "t1"}
    plan_id = create_plan_with_document(client, document)

    started = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json={"timeLimitSeconds": 1},
    )
    result = wait_for_terminal(client, started.json()["jobId"])["result"]

    assert sum(
        item["classId"] == "c1" and item["courseId"] == "k1"
        for item in result["placements"]
    ) == 3
    assert sum(
        item["classId"] == "c1" and item["courseId"] == "k2"
        for item in result["placements"]
    ) == 2


def test_result_has_no_class_or_teacher_conflicts(client: TestClient):
    document = workspace(hours=2)
    document["teachers"].append({"id": "t2", "name": "李老师"})
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    document["matrix"]["c1"]["k2"] = {"hours": 2, "teacherId": "t2"}
    document["matrix"]["c2"] = {
        "k1": {"hours": 2, "teacherId": "t1"}
    }
    plan_id = create_plan_with_document(client, document)

    started = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json={"timeLimitSeconds": 1},
    )
    placements = wait_for_terminal(
        client, started.json()["jobId"]
    )["result"]["placements"]

    class_slots = [
        (item["classId"], item["dayId"], item["periodId"])
        for item in placements
    ]
    teacher_slots = [
        (item["teacherId"], item["dayId"], item["periodId"])
        for item in placements
        if item["teacherId"]
    ]
    assert len(class_slots) == len(set(class_slots))
    assert len(teacher_slots) == len(set(teacher_slots))


def test_locked_placement_keeps_its_position(client: TestClient):
    document = workspace(hours=2)
    document["placements"] = [
        {
            "id": "p-locked",
            "classId": "c1",
            "courseId": "k1",
            "teacherId": "t1",
            "dayId": 1,
            "periodId": 5,
            "source": "manual",
            "locked": True,
        }
    ]
    plan_id = create_plan_with_document(client, document)

    started = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json={"timeLimitSeconds": 1},
    )
    placements = wait_for_terminal(
        client, started.json()["jobId"]
    )["result"]["placements"]

    locked = next(item for item in placements if item["id"] == "p-locked")
    assert (locked["dayId"], locked["periodId"], locked["locked"]) == (
        1,
        5,
        True,
    )


def test_excess_hours_go_to_park_instead_of_failing(client: TestClient):
    plan_id = create_plan_with_document(client, workspace(hours=10))

    started = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json={"timeLimitSeconds": 1},
    )
    job = wait_for_terminal(client, started.json()["jobId"])

    assert job["status"] == "done"
    assert len(job["result"]["placements"]) == 5
    assert len(job["result"]["park"]) == 5
    assert job["result"]["unmet"]


def test_same_plan_cannot_start_two_active_jobs(client: TestClient):
    document = workspace(hours=1)
    document["classes"] = [
        {
            "id": f"c{index}",
            "grade": "一年级",
            "name": f"{index}班",
            "room": str(index),
        }
        for index in range(100)
    ]
    document["courses"] = [
        {"id": f"k{index}", "name": f"课程{index}", "biweekly": False}
        for index in range(20)
    ]
    document["matrix"] = {
        school_class["id"]: {
            course["id"]: {"hours": 1, "teacherId": "t1"}
            for course in document["courses"]
        }
        for school_class in document["classes"]
    }
    plan_id = create_plan_with_document(client, document)

    first = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json={"timeLimitSeconds": 1},
    )
    second = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json={"timeLimitSeconds": 1},
    )

    assert first.status_code == 202
    assert second.status_code == 409
    client.post(f"/api/v1/solver/{first.json()['jobId']}/cancel")


def test_cancel_marks_job_cancelled(client: TestClient):
    plan_id = create_plan_with_document(client, workspace())
    started = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json={"timeLimitSeconds": 1},
    )
    job_id = started.json()["jobId"]

    cancelled = client.post(f"/api/v1/solver/{job_id}/cancel")
    job = client.get(f"/api/v1/solver/{job_id}")

    assert cancelled.status_code == 200
    assert cancelled.json() == {"ok": True}
    assert job.json()["status"] == "cancelled"


def test_solver_does_not_change_document_revision(client: TestClient):
    plan_id = create_plan_with_document(client, workspace())
    before = client.get(f"/api/v1/plans/{plan_id}/doc").json()

    started = client.post(
        f"/api/v1/plans/{plan_id}/solve",
        json={"timeLimitSeconds": 1},
    )
    job = wait_for_terminal(client, started.json()["jobId"])
    after = client.get(f"/api/v1/plans/{plan_id}/doc").json()

    assert job["status"] == "done"
    assert after["rev"] == before["rev"]
    assert after["doc"] == before["doc"]


def test_course_ban_keeps_course_out_of_cell(client: TestClient):
    document = workspace(hours=5)
    document["periods"].append(
        {
            "id": 6,
            "label": "6节",
            "band": "下午",
            "start": "13:00",
            "end": "13:40",
        }
    )
    document["rules"] = [
        rule(
            "禁排",
            subjectMode="course",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[{"dayId": 1, "periodId": 1}],
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert not any(
        item["courseId"] == "k1"
        and item["dayId"] == 1
        and item["periodId"] == 1
        for item in placements
    )


def test_teacher_ban_only_keeps_selected_teacher_out_of_cell(
    client: TestClient,
):
    document = workspace(hours=9)
    document["days"].append(
        {"id": 2, "label": "星期二", "short": "二"}
    )
    document["teachers"].append({"id": "t2", "name": "李老师"})
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["matrix"]["c2"] = {
        "k1": {"hours": 10, "teacherId": "t2"}
    }
    document["rules"] = [
        rule(
            "禁排",
            subjectMode="teacher",
            teacherIds=["t1"],
            courseIds=["not-k1"],
            classIds=["c2"],
            cells=[{"dayId": 2, "periodId": 3}],
        )
    ]

    placements = solve(client, document)["result"]["placements"]
    cell = [
        item
        for item in placements
        if item["dayId"] == 2 and item["periodId"] == 3
    ]

    assert not any(item["teacherId"] == "t1" for item in cell)
    assert any(item["teacherId"] == "t2" for item in cell)


def test_course_ban_with_empty_class_ids_applies_to_every_class(
    client: TestClient,
):
    document = workspace(hours=5)
    document["periods"].append(
        {
            "id": 6,
            "label": "6节",
            "band": "下午",
            "start": "13:00",
            "end": "13:40",
        }
    )
    document["teachers"].append({"id": "t2", "name": "李老师"})
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["matrix"]["c2"] = {
        "k1": {"hours": 5, "teacherId": "t2"}
    }
    document["rules"] = [
        rule(
            "禁排",
            subjectMode="course",
            courseIds=[],
            classIds=[],
            cells=[{"dayId": 1, "periodId": 1}],
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert not any(
        item["dayId"] == 1 and item["periodId"] == 1
        for item in placements
    )


def test_disabled_course_ban_does_not_apply(client: TestClient):
    document = workspace(hours=5)
    document["rules"] = [
        rule(
            "禁排",
            enabled=False,
            subjectMode="course",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[{"dayId": 1, "periodId": 1}],
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert any(
        item["courseId"] == "k1"
        and item["dayId"] == 1
        and item["periodId"] == 1
        for item in placements
    )


def test_must_rule_places_course_in_every_selected_cell(
    client: TestClient,
):
    document = workspace(hours=1)
    document["days"].append(
        {"id": 3, "label": "星期三", "short": "三"}
    )
    document["rules"] = [
        rule(
            "必排",
            subjectMode="course",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[{"dayId": 3, "periodId": 2}],
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert any(
        item["classId"] == "c1"
        and item["courseId"] == "k1"
        and item["dayId"] == 3
        and item["periodId"] == 2
        for item in placements
    )


def test_conflicting_must_and_ban_rule_is_reported_without_infeasible(
    client: TestClient,
):
    document = workspace(hours=1)
    cell = {"dayId": 1, "periodId": 1}
    document["rules"] = [
        rule(
            "必排",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[cell],
        ),
        rule(
            "禁排",
            subjectMode="course",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[cell],
        ),
    ]

    job = solve(client, document)

    assert job["status"] == "done"
    explanation = "；".join(item["text"] for item in job["result"]["unmet"])
    assert "必排" in explanation
    assert "禁排" in explanation


def test_must_rule_with_empty_class_ids_applies_to_every_class(
    client: TestClient,
):
    document = workspace(hours=1)
    document["days"].append(
        {"id": 3, "label": "星期三", "short": "三"}
    )
    document["teachers"].append({"id": "t2", "name": "李老师"})
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["matrix"]["c2"] = {
        "k1": {"hours": 1, "teacherId": "t2"}
    }
    document["rules"] = [
        rule(
            "必排",
            courseIds=["k1"],
            classIds=[],
            cells=[{"dayId": 3, "periodId": 2}],
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert {
        item["classId"]
        for item in placements
        if item["courseId"] == "k1"
        and item["dayId"] == 3
        and item["periodId"] == 2
    } == {"c1", "c2"}


def test_must_positions_over_course_hours_are_reported(
    client: TestClient,
):
    document = workspace(hours=1)
    document["rules"] = [
        rule(
            "必排",
            courseIds=["k1"],
            classIds=["c1"],
            cells=[
                {"dayId": 1, "periodId": 1},
                {"dayId": 1, "periodId": 2},
            ],
        )
    ]

    job = solve(client, document)

    assert job["status"] == "done"
    assert len(job["result"]["placements"]) == 1
    assert any(
        "必排位置" in item["text"] and "超过1课时" in item["text"]
        for item in job["result"]["unmet"]
    )


def test_teacher_group_never_teaches_at_the_same_time(client: TestClient):
    document = workspace(hours=1)
    document["periods"] = document["periods"][:1]
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    add_second_class(document, course_id="k2")
    document["rules"] = [
        rule("教师不同时上", teacherIds=["t1", "t2"])
    ]

    placements = solve(client, document)["result"]["placements"]
    occupied = {
        (item["teacherId"], item["dayId"], item["periodId"])
        for item in placements
    }

    assert not (
        ("t1", 1, 1) in occupied and ("t2", 1, 1) in occupied
    )


def test_disabled_teacher_group_rule_does_not_apply(client: TestClient):
    document = workspace(hours=1)
    document["periods"] = document["periods"][:1]
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    add_second_class(document, course_id="k2")
    document["rules"] = [
        rule(
            "教师不同时上",
            enabled=False,
            teacherIds=["t1", "t2"],
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert {item["teacherId"] for item in placements} == {"t1", "t2"}


def test_teacher_uses_at_most_one_cell_in_exclusive_region(
    client: TestClient,
):
    document = workspace(hours=3)
    document["periods"].append(
        {
            "id": 6,
            "label": "6节",
            "band": "下午",
            "start": "14:00",
            "end": "14:40",
        }
    )
    region = [{"dayId": 1, "periodId": period_id} for period_id in range(1, 5)]
    document["rules"] = [
        rule("节次互斥", teacherIds=["t1"], cells=region)
    ]

    placements = solve(client, document)["result"]["placements"]
    teacher_placements = [
        item for item in placements if item["teacherId"] == "t1"
    ]

    assert len(teacher_placements) == 3
    assert sum(
        {"dayId": item["dayId"], "periodId": item["periodId"]} in region
        for item in teacher_placements
    ) <= 1


def test_exclusive_region_limit_is_per_teacher(client: TestClient):
    document = workspace(hours=1)
    document["periods"] = document["periods"][:4]
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    add_second_class(document, course_id="k2")
    region = [
        {"dayId": 1, "periodId": period["id"]}
        for period in document["periods"]
    ]
    document["rules"] = [
        rule("节次互斥", teacherIds=["t1", "t2"], cells=region)
    ]

    placements = solve(client, document)["result"]["placements"]

    assert {item["teacherId"] for item in placements} == {"t1", "t2"}
    assert all(
        {"dayId": item["dayId"], "periodId": item["periodId"]} in region
        for item in placements
    )


def test_course_relation_keeps_from_course_out_of_next_to_course(
    client: TestClient,
):
    document = workspace(hours=1)
    document["periods"] = [
        {**document["periods"][0], "id": 10},
        {**document["periods"][1], "id": 30},
        {**document["periods"][2], "id": 20},
    ]
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    document["matrix"]["c1"]["k2"] = {"hours": 1, "teacherId": "t1"}
    document["rules"] = [
        rule(
            "课程不相邻",
            classIds=[],
            relFrom=["k1"],
            relTo=["k2"],
        )
    ]

    placements = solve(client, document)["result"]["placements"]
    course_by_period = {
        item["periodId"]: item["courseId"] for item in placements
    }

    assert all(
        not (
            course_by_period.get(period_a["id"]) == "k1"
            and course_by_period.get(period_b["id"]) == "k2"
        )
        for period_a, period_b in zip(
            document["periods"], document["periods"][1:]
        )
    )


def test_course_relation_is_directional(client: TestClient):
    document = workspace(hours=1)
    document["periods"] = document["periods"][:2]
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    document["matrix"]["c1"]["k2"] = {"hours": 1, "teacherId": "t1"}
    document["placements"] = [
        {
            "id": f"p-{course_id}",
            "classId": "c1",
            "courseId": course_id,
            "teacherId": "t1",
            "dayId": 1,
            "periodId": period_id,
            "source": "manual",
            "locked": True,
        }
        for course_id, period_id in (("k2", 1), ("k1", 2))
    ]
    document["rules"] = [
        rule(
            "课程不相邻",
            classIds=[],
            relFrom=["k1"],
            relTo=["k2"],
        )
    ]

    job = solve(client, document)

    assert job["status"] == "done"
    assert not job["result"]["park"]
    assert {
        (item["courseId"], item["periodId"])
        for item in job["result"]["placements"]
    } == {("k2", 1), ("k1", 2)}


def test_course_relation_does_not_cross_days(client: TestClient):
    document = workspace(hours=1)
    document["periods"] = document["periods"][:2]
    document["days"].append(
        {"id": 2, "label": "星期二", "short": "二"}
    )
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    document["matrix"]["c1"]["k2"] = {"hours": 1, "teacherId": "t1"}
    document["placements"] = [
        {
            "id": f"p-{course_id}",
            "classId": "c1",
            "courseId": course_id,
            "teacherId": "t1",
            "dayId": day_id,
            "periodId": period_id,
            "source": "manual",
            "locked": True,
        }
        for course_id, day_id, period_id in (
            ("k1", 1, 2),
            ("k2", 2, 1),
        )
    ]
    document["rules"] = [
        rule(
            "课程不相邻",
            classIds=[],
            relFrom=["k1"],
            relTo=["k2"],
        )
    ]

    job = solve(client, document)

    assert job["status"] == "done"
    assert not job["result"]["park"]
    assert {
        (item["courseId"], item["dayId"], item["periodId"])
        for item in job["result"]["placements"]
    } == {("k1", 1, 2), ("k2", 2, 1)}


def test_teacher_does_not_teach_both_selected_periods(
    client: TestClient,
):
    document = workspace(hours=2)
    document["periods"] = [
        document["periods"][0],
        document["periods"][2],
    ]
    document["rules"] = [
        rule(
            "教师不连上",
            teacherIds=["t1"],
            periodA=1,
            periodB=3,
        )
    ]

    job = solve(client, document)
    occupied_periods = {
        item["periodId"]
        for item in job["result"]["placements"]
        if item["teacherId"] == "t1"
    }

    assert job["status"] == "done"
    assert occupied_periods != {1, 3}
    assert len(job["result"]["park"]) == 1
    assert job["result"]["unmet"]


def test_disabled_adjacent_relation_rules_do_not_apply(client: TestClient):
    document = workspace(hours=1)
    document["periods"] = document["periods"][:3]
    document["courses"].extend(
        [
            {"id": "k2", "name": "数学", "biweekly": False},
            {"id": "k3", "name": "英语", "biweekly": False},
        ]
    )
    document["matrix"]["c1"].update(
        {
            "k2": {"hours": 1, "teacherId": "t1"},
            "k3": {"hours": 1, "teacherId": "t1"},
        }
    )
    document["placements"] = [
        {
            "id": f"p-{course_id}",
            "classId": "c1",
            "courseId": course_id,
            "teacherId": "t1",
            "dayId": 1,
            "periodId": period_id,
            "source": "manual",
            "locked": True,
        }
        for course_id, period_id in (("k1", 1), ("k2", 2), ("k3", 3))
    ]
    document["rules"] = [
        rule(
            "节次互斥",
            enabled=False,
            teacherIds=["t1"],
            cells=[
                {"dayId": 1, "periodId": 1},
                {"dayId": 1, "periodId": 2},
            ],
        ),
        rule(
            "课程不相邻",
            enabled=False,
            classIds=[],
            relFrom=["k1"],
            relTo=["k2"],
        ),
        rule(
            "教师不连上",
            enabled=False,
            teacherIds=["t1"],
            periodA=1,
            periodB=3,
        ),
    ]

    job = solve(client, document)

    assert job["status"] == "done"
    assert not job["result"]["park"]
    assert len(job["result"]["placements"]) == 3


def test_course_group_does_not_appear_on_the_same_day(client: TestClient):
    document = workspace(hours=1)
    document["periods"] = document["periods"][:2]
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    document["matrix"]["c1"]["k2"] = {"hours": 1, "teacherId": "t1"}
    document["rules"] = [
        rule(
            "课程不排同天",
            courseIds=["k1", "k2"],
            classIds=[],
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert {
        item["courseId"] for item in placements if item["dayId"] == 1
    } != {"k1", "k2"}


def test_course_group_only_applies_to_selected_class(client: TestClient):
    document = workspace(hours=1)
    document["periods"] = document["periods"][:2]
    document["courses"].append(
        {"id": "k2", "name": "数学", "biweekly": False}
    )
    document["matrix"]["c1"]["k2"] = {"hours": 1, "teacherId": "t1"}
    add_second_class(document)
    document["matrix"]["c2"]["k2"] = {"hours": 1, "teacherId": "t2"}
    document["rules"] = [
        rule(
            "课程不排同天",
            courseIds=["k1", "k2"],
            classIds=["c1"],
        )
    ]

    placements = solve(client, document)["result"]["placements"]
    courses_by_class = {
        class_id: {
            item["courseId"]
            for item in placements
            if item["classId"] == class_id
        }
        for class_id in ("c1", "c2")
    }

    assert courses_by_class["c1"] != {"k1", "k2"}
    assert courses_by_class["c2"] == {"k1", "k2"}


def test_courses_for_selected_classes_are_aligned_when_possible(
    client: TestClient,
):
    document = workspace(hours=1)
    add_second_class(document)
    document["rules"] = [
        rule(
            "课程尽量同时上",
            courseIds=["k1"],
            classIds=["c1", "c2"],
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert {
        (item["dayId"], item["periodId"]) for item in placements
    } == {(1, placements[0]["periodId"])}


def test_unachievable_course_alignment_is_soft_unmet(
    client: TestClient,
):
    document = workspace(hours=1)
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["matrix"]["c2"] = {
        "k1": {"hours": 1, "teacherId": "t1"}
    }
    document["rules"] = [
        rule(
            "课程尽量同时上",
            courseIds=["k1"],
            classIds=["c1", "c2"],
        )
    ]

    job = solve(client, document)

    assert job["status"] == "done"
    assert any(
        item.get("soft") is True and "课程尽量同时上" in item["text"]
        for item in job["result"]["unmet"]
    )


def add_days(document: dict, count: int) -> None:
    document["days"] = [
        {"id": day_id, "label": f"星期{day_id}", "short": str(day_id)}
        for day_id in range(1, count + 1)
    ]


def test_preferred_course_uses_only_selected_periods_when_possible(
    client: TestClient,
):
    document = workspace(hours=4)
    add_days(document, 2)
    document["rules"] = [
        rule(
            "课程优先排",
            courseIds=["k1"],
            classIds=[],
            periodIds=[1, 2],
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert len(placements) == 4
    assert {item["periodId"] for item in placements} <= {1, 2}


def test_unachievable_preferred_course_is_soft_unmet(
    client: TestClient,
):
    document = workspace(hours=3)
    document["rules"] = [
        rule(
            "课程优先排",
            courseIds=["k1"],
            classIds=["c1"],
            periodIds=[1, 2],
        )
    ]

    job = solve(client, document)

    assert job["status"] == "done"
    assert any(
        item.get("soft") is True
        and item["text"] == "「语文」有 1 节未落在优先节次"
        for item in job["result"]["unmet"]
    )


def test_daily_maximum_limits_each_day(client: TestClient):
    document = workspace(hours=3)
    add_days(document, 3)
    document["rules"] = [
        rule(
            "各天限制",
            subjectMode="course",
            courseIds=["k1"],
            classIds=[],
            dayIds=[1, 2, 3],
            limitType="最多",
            limitCount=1,
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert all(
        sum(
            item["classId"] == "c1"
            and item["courseId"] == "k1"
            and item["dayId"] == day_id
            for item in placements
        )
        <= 1
        for day_id in (1, 2, 3)
    )


def test_daily_minimum_puts_course_on_every_day(client: TestClient):
    document = workspace(hours=3)
    add_days(document, 3)
    document["rules"] = [
        rule(
            "各天限制",
            subjectMode="course",
            courseIds=["k1"],
            classIds=["c1"],
            dayIds=[1, 2, 3],
            limitType="最少",
            limitCount=1,
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert {
        item["dayId"]
        for item in placements
        if item["classId"] == "c1" and item["courseId"] == "k1"
    } == {1, 2, 3}


def test_daily_fixed_count_is_exact(client: TestClient):
    document = workspace(hours=6)
    add_days(document, 3)
    document["rules"] = [
        rule(
            "各天限制",
            subjectMode="course",
            courseIds=["k1"],
            classIds=[],
            dayIds=[1, 2, 3],
            limitType="固定",
            limitCount=2,
        )
    ]

    placements = solve(client, document)["result"]["placements"]

    assert [
        sum(item["dayId"] == day_id for item in placements)
        for day_id in (1, 2, 3)
    ] == [2, 2, 2]


def test_daily_teacher_limit_counts_across_classes(client: TestClient):
    teacher_document = workspace(hours=2)
    add_days(teacher_document, 2)
    teacher_document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    teacher_document["matrix"]["c2"] = {
        "k1": {"hours": 2, "teacherId": "t1"}
    }
    teacher_document["rules"] = [
        rule(
            "各天限制",
            subjectMode="teacher",
            teacherIds=["t1"],
            classIds=[],
            dayIds=[1, 2],
            limitType="最多",
            limitCount=1,
        )
    ]
    course_document = {
        **teacher_document,
        "rules": [
            rule(
                "各天限制",
                subjectMode="course",
                courseIds=["k1"],
                classIds=[],
                dayIds=[1, 2],
                limitType="最多",
                limitCount=1,
            )
        ],
    }

    teacher_result = solve(client, teacher_document)["result"]
    course_result = solve(client, course_document)["result"]

    assert len(teacher_result["placements"]) == 2
    assert len(teacher_result["park"]) == 2
    assert len(course_result["placements"]) == 4
    assert not course_result["park"]


def test_impossible_daily_minimum_is_reported_without_infeasible(
    client: TestClient,
):
    document = workspace(hours=3)
    add_days(document, 5)
    document["rules"] = [
        rule(
            "各天限制",
            subjectMode="course",
            courseIds=["k1"],
            classIds=["c1"],
            dayIds=[1, 2, 3, 4, 5],
            limitType="最少",
            limitCount=1,
        )
    ]

    job = solve(client, document)

    assert job["status"] == "done"
    assert any(
        "各天限制" in item["text"] and "少于最少 1 节" in item["text"]
        for item in job["result"]["unmet"]
    )


def test_period_limit_counts_selected_periods_across_all_days(
    client: TestClient,
):
    document = workspace(hours=3)
    add_days(document, 3)
    document["periods"] = document["periods"][:2]
    document["rules"] = [
        rule(
            "时段限制",
            subjectMode="course",
            courseIds=["k1"],
            classIds=[],
            periodIds=[1, 2],
            limitType="最多",
            limitCount=2,
        )
    ]

    result = solve(client, document)["result"]

    assert len(result["placements"]) == 2
    assert len(result["park"]) == 1


def test_lesson_plan_alignment_uses_the_same_slot_for_same_teacher(
    client: TestClient,
):
    document = workspace(hours=1)
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["matrix"]["c2"] = {
        "k1": {"hours": 1, "teacherId": "t1"}
    }
    document["rules"] = [
        rule("教案齐头", align={"t1|k1": "优先满足"})
    ]

    result = solve(client, document)["result"]

    assert {
        (item["dayId"], item["periodId"])
        for item in result["placements"]
    } == {(1, result["placements"][0]["periodId"])}
    assert not any("教案齐头" in item["text"] for item in result["unmet"])


def test_empty_lesson_plan_alignment_strength_is_disabled(
    client: TestClient,
):
    document = workspace(hours=1)
    document["classes"].append(
        {"id": "c2", "grade": "一年级", "name": "2班", "room": "102"}
    )
    document["matrix"]["c2"] = {
        "k1": {"hours": 1, "teacherId": "t1"}
    }
    document["rules"] = [rule("教案齐头", align={"t1|k1": ""})]

    result = solve(client, document)["result"]

    assert not any("教案齐头" in item["text"] for item in result["unmet"])
