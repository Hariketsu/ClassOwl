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


def create_plan(client: TestClient) -> dict:
    response = client.post("/api/v1/plans", json={})
    assert response.status_code == 201, response.text
    return response.json()


def test_record_and_list_imports(client: TestClient):
    plan = create_plan(client)
    created = client.post(
        f"/api/v1/plans/{plan['id']}/imports",
        json={
            "kind": "teaching",
            "source": "粘贴导入",
            "summary": "已导入 12 条任课（当前年级，已替换）",
        },
    )
    assert created.status_code == 201, created.text
    record = created.json()
    assert record["kind"] == "teaching"
    assert record["summary"].startswith("已导入 12 条")
    assert record["createdAt"]

    listed = client.get(f"/api/v1/plans/{plan['id']}/imports")
    assert listed.status_code == 200, listed.text
    records = listed.json()
    assert len(records) == 1
    assert records[0]["id"] == record["id"]


def test_list_imports_newest_first(client: TestClient):
    plan = create_plan(client)
    for index in range(3):
        client.post(
            f"/api/v1/plans/{plan['id']}/imports",
            json={"kind": "teaching", "source": "粘贴导入", "summary": f"第 {index} 次"},
        )
    records = client.get(f"/api/v1/plans/{plan['id']}/imports").json()
    assert [record["summary"] for record in records] == ["第 2 次", "第 1 次", "第 0 次"]


def test_record_import_rejects_unknown_kind(client: TestClient):
    plan = create_plan(client)
    response = client.post(
        f"/api/v1/plans/{plan['id']}/imports",
        json={"kind": "unknown", "source": "x", "summary": "y"},
    )
    assert response.status_code == 422


def test_imports_require_existing_plan(client: TestClient):
    response = client.get("/api/v1/plans/nope/imports")
    assert response.status_code == 404
    response = client.post(
        "/api/v1/plans/nope/imports",
        json={"kind": "teaching", "source": "x", "summary": "y"},
    )
    assert response.status_code == 404


def test_import_history_cascades_with_plan(client: TestClient):
    plan = create_plan(client)
    client.post(
        f"/api/v1/plans/{plan['id']}/imports",
        json={"kind": "teaching", "source": "粘贴导入", "summary": "一次导入"},
    )
    deleted = client.delete(f"/api/v1/plans/{plan['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/plans/{plan['id']}/imports").status_code == 404
