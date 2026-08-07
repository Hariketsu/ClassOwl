from __future__ import annotations

import sqlite3
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from classowl.app import create_app


TOKEN = "test-token"
HEADERS = {"X-ClassOwl-Token": TOKEN}


def empty_workspace(name: str = "新建排课方案 1") -> dict:
    return {
        "schemeName": name,
        "days": [],
        "periods": [],
        "teachers": [],
        "classes": [],
        "courses": [],
        "gradeCourses": {},
        "matrix": {},
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


@pytest.fixture
def plans_client(tmp_path: Path):
    with TestClient(create_app(TOKEN, tmp_path)) as client:
        client.headers.update(HEADERS)
        yield client


def create_plan(client: TestClient) -> dict:
    response = client.post("/api/v1/plans")
    assert response.status_code == 201, response.text
    return response.json()


def put_doc(
    client: TestClient,
    plan_id: str,
    base_rev: int,
    doc: dict,
    checkpoint: str | None = None,
):
    return client.put(
        f"/api/v1/plans/{plan_id}/doc",
        json={"baseRev": base_rev, "doc": doc, "checkpoint": checkpoint},
    )


def test_new_plan_appears_in_plan_list(plans_client: TestClient):
    created = create_plan(plans_client)

    response = plans_client.get("/api/v1/plans")

    assert response.status_code == 200
    assert response.json() == [created]


def test_plan_metadata_can_be_updated_and_deleted(plans_client: TestClient):
    plan = create_plan(plans_client)

    updated = plans_client.patch(
        f"/api/v1/plans/{plan['id']}",
        json={
            "name": "2027 春季方案",
            "academicYear": "2026-2027 学年",
            "term": "春季学期",
            "progress": 3,
            "status": "ready",
            "lastStep": "setting-rules",
        },
    )
    deleted = plans_client.delete(f"/api/v1/plans/{plan['id']}")

    assert updated.status_code == 200
    assert updated.json()["name"] == "2027 春季方案"
    assert updated.json()["lastStep"] == "setting-rules"
    assert deleted.status_code == 204
    assert plans_client.get("/api/v1/plans").json() == []


def test_system_status_requires_token_and_reports_ortools(
    tmp_path: Path,
):
    with TestClient(create_app(TOKEN, tmp_path)) as client:
        unauthorized = client.get("/api/v1/system/status")
        authorized = client.get("/api/v1/system/status", headers=HEADERS)
        exited = client.post("/api/v1/system/exit", headers=HEADERS)

    assert unauthorized.status_code == 401
    assert authorized.status_code == 200
    assert authorized.json()["ortoolsVersion"]
    assert exited.json() == {"ok": True}


def test_written_document_is_read_back_unchanged(plans_client: TestClient):
    plan = create_plan(plans_client)
    initial = plans_client.get(f"/api/v1/plans/{plan['id']}/doc").json()
    document = empty_workspace()
    document["teachers"] = [{"id": "t1", "name": "王老师"}]
    document["classes"] = [
        {"id": "c1", "grade": "一年级", "name": "1班", "room": "101"}
    ]
    document["courses"] = [{"id": "k1", "name": "语文", "biweekly": False}]
    document["gradeCourses"] = {"一年级": ["k1"]}
    document["matrix"] = {
        "c1": {"k1": {"hours": 6, "teacherId": "t1"}}
    }
    document["days"] = [{"id": 1, "label": "星期一", "short": "一"}]
    document["periods"] = [
        {
            "id": 1,
            "label": "1节",
            "band": "上午",
            "start": "08:00",
            "end": "08:40",
        }
    ]
    document["linked"] = [
        {
            "id": "linked1",
            "courseId": "k1",
            "classIds": ["c1"],
            "timesPerWeek": 1,
            "consecutive": 2,
        }
    ]
    document["biweekly"] = [
        {
            "id": "biweekly1",
            "courseA": "k1",
            "courseB": "k2",
            "classIds": ["c1"],
            "oddCourseId": "k1",
        }
    ]
    document["combined"] = [
        {"id": "combined1", "courseId": "k1", "classIds": ["c1"]}
    ]
    document["layered"] = [
        {
            "id": "layered1",
            "courseId": "k1",
            "classId": "c1",
            "name": "分层班",
            "teacherId": "t1",
        }
    ]
    document["venues"] = [
        {
            "id": "venue1",
            "name": "音乐室",
            "capacity": 1,
            "courseIds": ["k1"],
        }
    ]
    document["rules"] = [
        {
            "id": f"r{index}",
            "type": rule_type,
            "enabled": True,
            "note": "",
            "summary": rule_type,
        }
        for index, rule_type in enumerate(
            [
                "禁排",
                "必排",
                "教师不同时上",
                "课程不排同天",
                "节次互斥",
                "课程不相邻",
                "课程优先排",
                "课程尽量同时上",
                "教师不连上",
                "各天限制",
                "时段限制",
                "教案齐头",
            ]
        )
    ]
    document["rules"][0].update(
        {
            "subjectMode": "course",
            "courseIds": ["k1"],
            "classIds": ["c1"],
            "teacherIds": ["t1"],
            "cells": [{"dayId": 1, "periodId": 1}],
            "periodIds": [1],
            "dayIds": [1],
            "limitType": "最多",
            "limitCount": 1,
            "periodA": 1,
            "periodB": 2,
            "relFrom": ["k1"],
            "relTo": ["k2"],
            "align": {"t1|k1": "优先满足"},
        }
    )

    written = put_doc(plans_client, plan["id"], initial["rev"], document)
    fetched = plans_client.get(f"/api/v1/plans/{plan['id']}/doc")

    assert written.status_code == 200, written.text
    assert fetched.status_code == 200
    assert fetched.json()["doc"] == document


def test_stale_base_revision_is_rejected(plans_client: TestClient):
    plan = create_plan(plans_client)
    document = empty_workspace()
    first = put_doc(plans_client, plan["id"], 0, document)

    stale = put_doc(plans_client, plan["id"], 0, document)

    assert first.status_code == 200
    assert stale.status_code == 409


def test_newer_schema_version_is_rejected_with_readable_error(tmp_path: Path):
    app = create_app(TOKEN, tmp_path)
    with TestClient(app) as client:
        client.headers.update(HEADERS)
        plan = create_plan(client)
    with sqlite3.connect(tmp_path / "classowl.db") as db:
        db.execute(
            "UPDATE plan_docs SET schema_version = 999 WHERE plan_id = ?",
            (plan["id"],),
        )

    with TestClient(app) as client:
        client.headers.update(HEADERS)
        response = client.get(f"/api/v1/plans/{plan['id']}/doc")

    assert response.status_code == 409
    assert "999" in response.json()["detail"]
    assert "1" in response.json()["detail"]


def test_older_schema_version_is_migrated_and_written_back(tmp_path: Path):
    app = create_app(TOKEN, tmp_path)
    with TestClient(app) as client:
        client.headers.update(HEADERS)
        plan = create_plan(client)
    with sqlite3.connect(tmp_path / "classowl.db") as db:
        db.execute(
            "UPDATE plan_docs SET schema_version = 0 WHERE plan_id = ?",
            (plan["id"],),
        )

    with TestClient(app) as client:
        client.headers.update(HEADERS)
        response = client.get(f"/api/v1/plans/{plan['id']}/doc")
    with sqlite3.connect(tmp_path / "classowl.db") as db:
        stored_version = db.execute(
            "SELECT schema_version FROM plan_docs WHERE plan_id = ?",
            (plan["id"],),
        ).fetchone()[0]

    assert response.status_code == 200
    assert response.json()["schemaVersion"] == 1
    assert stored_version == 1


def test_plain_saves_do_not_create_undo_entries(plans_client: TestClient):
    plan = create_plan(plans_client)
    rev = 0
    for index in range(10):
        document = empty_workspace()
        document["schemeName"] = f"保存 {index}"
        response = put_doc(plans_client, plan["id"], rev, document)
        assert response.status_code == 200, response.text
        rev = response.json()["rev"]

    fetched = plans_client.get(f"/api/v1/plans/{plan['id']}/doc").json()

    assert fetched["undoDepth"] == 0


def test_checkpoint_can_be_undone_and_redone(plans_client: TestClient):
    plan = create_plan(plans_client)
    before = empty_workspace()
    after = deepcopy(before)
    after["placements"] = [
        {
            "id": "p1",
            "classId": "c1",
            "courseId": "k1",
            "teacherId": "t1",
            "dayId": 1,
            "periodId": 1,
            "source": "manual",
            "locked": False,
        }
    ]
    after["scheduleStatus"] = "ready"

    saved = put_doc(plans_client, plan["id"], 0, after, "移动语文")
    undone = plans_client.post(f"/api/v1/plans/{plan['id']}/undo")
    redone = plans_client.post(f"/api/v1/plans/{plan['id']}/redo")

    assert saved.status_code == 200
    assert undone.status_code == 200
    assert undone.json()["doc"] == before
    assert redone.status_code == 200
    assert redone.json()["doc"] == after


def test_revision_history_keeps_only_latest_fifty(plans_client: TestClient):
    plan = create_plan(plans_client)
    rev = 0
    for index in range(51):
        document = empty_workspace()
        document["schemeName"] = f"版本 {index + 1}"
        response = put_doc(
            plans_client, plan["id"], rev, document, f"修改 {index + 1}"
        )
        assert response.status_code == 200, response.text
        rev = response.json()["rev"]

    assert response.json()["undoDepth"] == 50
    for _ in range(50):
        undo = plans_client.post(f"/api/v1/plans/{plan['id']}/undo")
        assert undo.status_code == 200

    assert undo.json()["doc"]["schemeName"] == "版本 1"
    assert undo.json()["undoDepth"] == 0


def test_duplicate_is_independent_and_marks_schedule_stale(
    plans_client: TestClient,
):
    original = create_plan(plans_client)
    document = empty_workspace()
    document["placements"] = [
        {
            "id": "p1",
            "classId": "c1",
            "courseId": "k1",
            "teacherId": "t1",
            "dayId": 1,
            "periodId": 1,
            "source": "auto",
            "locked": True,
        }
    ]
    document["park"] = [
        {
            "id": "park1",
            "classId": "c1",
            "courseId": "k1",
            "teacherId": "t1",
            "source": "manual",
        }
    ]
    document["scheduleStatus"] = "ready"
    put_doc(plans_client, original["id"], 0, document)

    duplicate = plans_client.post(
        f"/api/v1/plans/{original['id']}/duplicate"
    )
    copied_id = duplicate.json()["id"]
    copied = plans_client.get(f"/api/v1/plans/{copied_id}/doc").json()
    changed = deepcopy(copied["doc"])
    changed["placements"] = []
    put_doc(plans_client, copied_id, copied["rev"], changed)
    unchanged = plans_client.get(
        f"/api/v1/plans/{original['id']}/doc"
    ).json()

    assert duplicate.status_code == 201
    assert copied["doc"]["scheduleStatus"] == "stale"
    assert copied["doc"]["placements"] == document["placements"]
    assert copied["doc"]["park"] == document["park"]
    assert unchanged["doc"] == document


@pytest.mark.parametrize(
    "document",
    [
        {"schemeName": "缺字段"},
        {**empty_workspace(), "days": "星期一"},
    ],
)
def test_malformed_document_is_a_client_error(
    plans_client: TestClient, document: dict
):
    plan = create_plan(plans_client)

    response = put_doc(plans_client, plan["id"], 0, document)

    assert 400 <= response.status_code < 500
