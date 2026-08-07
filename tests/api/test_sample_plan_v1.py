from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from classowl.app import create_app


TOKEN = "test-token"
HEADERS = {"X-ClassOwl-Token": TOKEN}


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(TOKEN, tmp_path)) as test_client:
        test_client.headers.update(HEADERS)
        yield test_client


def test_create_sample_plan_seeds_demo_workspace(client: TestClient):
    response = client.post("/api/v1/plans", json={"source": "sample"})
    assert response.status_code == 201, response.text
    plan = response.json()
    assert plan["name"] == "示例方案"
    assert plan["status"] == "ready"

    document = client.get(f"/api/v1/plans/{plan['id']}/doc").json()["doc"]
    assert document["schemeName"] == "示例方案"
    assert len(document["days"]) == 5
    assert len(document["periods"]) == 6
    assert len(document["teachers"]) == 10
    assert len(document["classes"]) == 5
    assert len(document["courses"]) == 13
    assert len(document["rules"]) == 4
    assert len(document["linked"]) == 1
    assert len(document["biweekly"]) == 1
    # 示例自带预排好的完整结果（固化的 fixture），不再是空课表。
    assert len(document["placements"]) == 125
    assert document["park"] == []
    assert document["scheduleStatus"] == "ready"

    # 课时矩阵与演示数据同源：一年级1班语文 8 节、班会 1 节。
    assert document["matrix"]["c1"]["k3"]["hours"] == 8
    assert document["matrix"]["c1"]["k1"]["hours"] == 1


def test_sample_plan_is_fully_scheduled_and_ready(client: TestClient):
    """示例方案创建即为 progress=5/ready/preview-export，且结果零硬冲突。"""
    response = client.post("/api/v1/plans", json={"source": "sample"})
    assert response.status_code == 201, response.text
    plan = response.json()
    assert plan["progress"] == 5
    assert plan["status"] == "ready"
    assert plan["lastStep"] == "preview-export"

    document = client.get(f"/api/v1/plans/{plan['id']}/doc").json()["doc"]
    placements = document["placements"]

    # placements 总量等于课时矩阵的课时总数。
    total_hours = sum(
        cell["hours"]
        for row in document["matrix"].values()
        for cell in row.values()
    )
    assert len(placements) == total_hours

    # 引用完整：班级/课程/教师/课位都存在，id 唯一。
    class_ids = {item["id"] for item in document["classes"]}
    course_ids = {item["id"] for item in document["courses"]}
    teacher_ids = {item["id"] for item in document["teachers"]}
    slots = {
        (day["id"], period["id"])
        for day in document["days"]
        for period in document["periods"]
    }
    assert len({placement["id"] for placement in placements}) == len(placements)
    for placement in placements:
        assert placement["classId"] in class_ids
        assert placement["courseId"] in course_ids
        assert placement["teacherId"] in teacher_ids
        assert (placement["dayId"], placement["periodId"]) in slots

    # 零硬冲突：同一班级/同一教师在同一课位至多一条。
    class_slots = [
        (p["classId"], p["dayId"], p["periodId"]) for p in placements
    ]
    teacher_slots = [
        (p["teacherId"], p["dayId"], p["periodId"]) for p in placements
    ]
    assert len(set(class_slots)) == len(class_slots)
    assert len(set(teacher_slots)) == len(teacher_slots)

    # 禁排条件（体育不排第 1 节）与必排条件（班会周一第 6 节）均被满足。
    assert not any(
        p["courseId"] == "k6" and p["periodId"] == 1 for p in placements
    )
    for class_id, course_id in (("c1", "k1"), ("c4", "k1")):
        assert any(
            p["classId"] == class_id
            and p["courseId"] == course_id
            and p["dayId"] == 1
            and p["periodId"] == 6
            for p in placements
        )


def test_create_blank_plan_stays_empty(client: TestClient):
    response = client.post("/api/v1/plans", json={"source": "blank"})
    assert response.status_code == 201, response.text
    plan = response.json()
    document = client.get(f"/api/v1/plans/{plan['id']}/doc").json()["doc"]
    assert document["classes"] == []
    assert document["courses"] == []


def test_sample_plan_name_can_be_overridden(client: TestClient):
    response = client.post(
        "/api/v1/plans",
        json={"source": "sample", "name": "全海小学"},
    )
    assert response.status_code == 201, response.text
    plan = response.json()
    assert plan["name"] == "全海小学"
    document = client.get(f"/api/v1/plans/{plan['id']}/doc").json()["doc"]
    assert document["schemeName"] == "全海小学"
    assert len(document["classes"]) == 5
