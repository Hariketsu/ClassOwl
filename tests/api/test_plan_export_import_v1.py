from __future__ import annotations

import base64
import io
import json
import zipfile
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


def create_sample_plan(client: TestClient) -> dict:
    response = client.post("/api/v1/plans", json={"source": "sample"})
    assert response.status_code == 201, response.text
    return response.json()


def export_zip_payload(manifest: dict, doc: dict) -> str:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("doc.json", json.dumps(doc))
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_export_import_round_trip(client: TestClient):
    plan = create_sample_plan(client)
    exported = client.get(f"/api/v1/plans/{plan['id']}/export")
    assert exported.status_code == 200, exported.text
    payload = exported.json()
    assert payload["fileName"].endswith(".classowl.zip")

    archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(payload["data"])))
    assert set(archive.namelist()) == {"manifest.json", "doc.json"}
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["format"] == "classowl-plan"
    assert manifest["formatVersion"] == 1
    assert manifest["plan"]["name"] == "示例方案"

    imported = client.post("/api/v1/plans/import", json={"data": payload["data"]})
    assert imported.status_code == 201, imported.text
    imported_plan = imported.json()
    assert imported_plan["name"] == "示例方案"
    assert imported_plan["id"] != plan["id"]

    original_doc = client.get(f"/api/v1/plans/{plan['id']}/doc").json()["doc"]
    imported_doc = client.get(f"/api/v1/plans/{imported_plan['id']}/doc").json()["doc"]
    assert imported_doc == original_doc


def test_import_rejects_garbage(client: TestClient):
    response = client.post("/api/v1/plans/import", json={"data": "not-base64!!!"})
    assert response.status_code == 400

    response = client.post(
        "/api/v1/plans/import",
        json={"data": base64.b64encode(b"plain bytes").decode("ascii")},
    )
    assert response.status_code == 400


def test_import_rejects_unsupported_version(client: TestClient):
    sample = create_sample_plan(client)
    exported = client.get(f"/api/v1/plans/{sample['id']}/export").json()
    archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(exported["data"])))
    manifest = json.loads(archive.read("manifest.json"))
    doc = json.loads(archive.read("doc.json"))

    manifest["formatVersion"] = 99
    payload = export_zip_payload(manifest, doc)
    response = client.post("/api/v1/plans/import", json={"data": payload})
    assert response.status_code == 400


def test_import_name_override(client: TestClient):
    sample = create_sample_plan(client)
    exported = client.get(f"/api/v1/plans/{sample['id']}/export").json()
    response = client.post(
        "/api/v1/plans/import",
        json={"data": exported["data"], "name": "分校复刻"},
    )
    assert response.status_code == 201, response.text
    plan = response.json()
    assert plan["name"] == "分校复刻"
    doc = client.get(f"/api/v1/plans/{plan['id']}/doc").json()["doc"]
    assert doc["schemeName"] == "分校复刻"
