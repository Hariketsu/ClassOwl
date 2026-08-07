from __future__ import annotations

from copy import deepcopy
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


def create_plan(client: TestClient) -> dict:
    response = client.post("/api/v1/plans")
    assert response.status_code == 201, response.text
    return response.json()


def source_document() -> dict:
    return {
        "schemeName": "来源方案",
        "days": [{"id": 1, "label": "星期一", "short": "一"}],
        "periods": [
            {
                "id": 1,
                "label": "1节",
                "band": "上午",
                "start": "08:00",
                "end": "08:40",
            }
        ],
        "classes": [
            {"id": "c1", "grade": "一年级", "name": "1班", "room": "101"}
        ],
        "courses": [{"id": "k1", "name": "语文", "biweekly": False}],
        "gradeCourses": {"一年级": ["k1"]},
        "teachers": [{"id": "t1", "name": "王老师"}],
        "matrix": {"c1": {"k1": {"hours": 6, "teacherId": "t1"}}},
        "linked": [
            {
                "id": "linked1",
                "courseId": "k1",
                "classIds": ["c1"],
                "timesPerWeek": 1,
                "consecutive": 2,
            }
        ],
        "biweekly": [
            {
                "id": "biweekly1",
                "courseA": "k1",
                "courseB": "k1",
                "classIds": ["c1"],
                "oddCourseId": "k1",
            }
        ],
        "combined": [
            {"id": "combined1", "courseId": "k1", "classIds": ["c1"]}
        ],
        "layered": [
            {
                "id": "layered1",
                "courseId": "k1",
                "classId": "c1",
                "name": "分层班",
                "teacherId": "t1",
            }
        ],
        "venues": [
            {
                "id": "venue1",
                "name": "音乐室",
                "capacity": 1,
                "courseIds": ["k1"],
            }
        ],
        "rules": [
            {
                "id": "r1",
                "type": "禁排",
                "enabled": True,
                "note": "",
                "summary": "语文禁排",
                "classIds": ["c1"],
                "courseIds": ["k1"],
                "teacherIds": ["t1"],
            }
        ],
        "placements": [
            {
                "id": "p1",
                "classId": "c1",
                "courseId": "k1",
                "teacherId": "t1",
                "dayId": 1,
                "periodId": 1,
                "source": "auto",
                "locked": False,
            }
        ],
        "park": [
            {
                "id": "park1",
                "classId": "c1",
                "courseId": "k1",
                "teacherId": "t1",
                "source": "manual",
            }
        ],
        "scheduleStatus": "ready",
    }


def put_document(
    client: TestClient, plan_id: str, document: dict, base_rev: int = 0
):
    response = client.put(
        f"/api/v1/plans/{plan_id}/doc",
        json={"baseRev": base_rev, "doc": document, "checkpoint": None},
    )
    assert response.status_code == 200, response.text
    return response.json()


def import_from(
    client: TestClient, target_id: str, source_id: str, level: int
):
    return client.post(
        f"/api/v1/plans/{target_id}/import-from",
        json={"sourcePlanId": source_id, "level": level},
    )


def test_level_one_import_replaces_basics_and_clears_later_steps(
    client: TestClient,
):
    source = create_plan(client)
    target = create_plan(client)
    document = source_document()
    put_document(client, source["id"], document)

    response = import_from(client, target["id"], source["id"], 1)

    assert response.status_code == 200, response.text
    imported = response.json()["doc"]
    assert imported["days"] == document["days"]
    assert imported["periods"] == document["periods"]
    assert imported["classes"] == document["classes"]
    for field in (
        "courses",
        "teachers",
        "linked",
        "biweekly",
        "combined",
        "layered",
        "venues",
        "rules",
        "placements",
        "park",
    ):
        assert imported[field] == []
    assert imported["gradeCourses"] == {}
    assert imported["matrix"] == {}
    assert imported["scheduleStatus"] == "stale"


def test_level_two_import_replaces_teaching_and_clears_schedule_data(
    client: TestClient,
):
    source = create_plan(client)
    target = create_plan(client)
    document = source_document()
    put_document(client, source["id"], document)

    response = import_from(client, target["id"], source["id"], 2)

    assert response.status_code == 200, response.text
    imported = response.json()["doc"]
    for field in (
        "days",
        "periods",
        "classes",
        "courses",
        "gradeCourses",
        "teachers",
        "matrix",
        "linked",
        "biweekly",
        "combined",
        "layered",
        "venues",
    ):
        assert imported[field] == document[field]
    assert imported["rules"] == []
    assert imported["placements"] == []
    assert imported["park"] == []
    assert imported["scheduleStatus"] == "stale"


def test_level_three_import_includes_rules_but_not_schedule_results(
    client: TestClient,
):
    source = create_plan(client)
    target = create_plan(client)
    document = source_document()
    put_document(client, source["id"], document)

    response = import_from(client, target["id"], source["id"], 3)

    assert response.status_code == 200, response.text
    imported = response.json()["doc"]
    assert imported["rules"] == document["rules"]
    assert imported["placements"] == []
    assert imported["park"] == []
    assert imported["scheduleStatus"] == "stale"


def test_import_does_not_change_source_plan(client: TestClient):
    source = create_plan(client)
    target = create_plan(client)
    document = source_document()
    put_document(client, source["id"], document)
    before = client.get(f"/api/v1/plans/{source['id']}/doc").json()

    response = import_from(client, target["id"], source["id"], 3)
    after = client.get(f"/api/v1/plans/{source['id']}/doc").json()

    assert response.status_code == 200, response.text
    assert after == before


def test_import_rejects_missing_source_plan(client: TestClient):
    target = create_plan(client)

    response = import_from(client, target["id"], "missing-plan", 1)

    assert response.status_code == 404
    assert response.json() == {"detail": "方案不存在"}


def test_import_rejects_matrix_reference_to_missing_class(
    client: TestClient,
):
    source = create_plan(client)
    target = create_plan(client)
    document = source_document()
    document["matrix"]["missing-class"] = deepcopy(document["matrix"]["c1"])
    put_document(client, source["id"], document)

    response = import_from(client, target["id"], source["id"], 2)

    assert response.status_code == 422
    assert response.json() == {
        "detail": "matrix 中的 classId missing-class 不存在"
    }


def test_import_creates_an_undo_checkpoint(client: TestClient):
    source = create_plan(client)
    target = create_plan(client)
    put_document(client, source["id"], source_document())

    response = import_from(client, target["id"], source["id"], 1)
    fetched = client.get(f"/api/v1/plans/{target['id']}/doc").json()

    assert response.status_code == 200, response.text
    assert response.json()["rev"] == 1
    assert fetched["undoDepth"] == 1


def test_repeated_imports_each_create_a_new_revision(client: TestClient):
    source = create_plan(client)
    target = create_plan(client)
    put_document(client, source["id"], source_document())

    first = import_from(client, target["id"], source["id"], 1)
    second = import_from(client, target["id"], source["id"], 1)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["rev"] > first.json()["rev"]
