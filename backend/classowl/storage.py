from __future__ import annotations

import base64
import binascii
import io
import json
import sqlite3
import zipfile
from collections.abc import Callable
from copy import deepcopy
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from .models import (
    CreatePlan,
    FlowPlan,
    ImportRecord,
    RecordImport,
    UpdatePlan,
    Workspace,
    empty_workspace,
)
from .sample import sample_workspace


CURRENT_SCHEMA_VERSION = 1
MAX_REVISIONS = 50
MIGRATIONS: dict[int, Callable[[dict], dict]] = {0: lambda doc: doc}

#: 方案导出 zip 的格式标识与版本。导入时校验二者，不兼容即拒绝。
PLAN_EXPORT_FORMAT = "classowl-plan"
PLAN_EXPORT_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  term          TEXT NOT NULL,
  status        TEXT NOT NULL,
  progress      INTEGER NOT NULL,
  last_step     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_docs (
  plan_id        TEXT PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  rev            INTEGER NOT NULL,
  doc            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_revisions (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  label   TEXT NOT NULL,
  doc     TEXT NOT NULL,
  PRIMARY KEY (plan_id, seq)
);

CREATE TABLE IF NOT EXISTS import_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  source     TEXT NOT NULL,
  summary    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"""


class StorageError(Exception):
    pass


class NotFoundError(StorageError):
    pass


class RevisionConflictError(StorageError):
    pass


class FutureSchemaError(StorageError):
    pass


class MigrationError(StorageError):
    pass


class ReferenceIntegrityError(StorageError):
    pass


class InvalidPlanFileError(StorageError):
    """导入的方案文件不是有效的 ClassOwl 导出包，或格式版本不兼容。"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _dump(document: Workspace) -> str:
    return json.dumps(
        document.model_dump(mode="json", exclude_none=True),
        ensure_ascii=False,
        separators=(",", ":"),
    )


class DocumentStore:
    def __init__(self, data_dir: Path):
        data_dir.mkdir(parents=True, exist_ok=True)
        self.path = data_dir / "classowl.db"
        with self._connect() as connection:
            connection.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.path, timeout=15, check_same_thread=False
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 15000")
        return connection

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _plan(row: sqlite3.Row) -> FlowPlan:
        return FlowPlan(
            id=row["id"],
            name=row["name"],
            academicYear=row["academic_year"],
            term=row["term"],
            updatedAt=row["updated_at"],
            progress=row["progress"],
            status=row["status"],
            lastStep=row["last_step"],
        )

    def list_plans(self) -> list[FlowPlan]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM plans ORDER BY updated_at DESC, created_at DESC"
            ).fetchall()
        return [self._plan(row) for row in rows]

    def create_plan(self, request: CreatePlan) -> FlowPlan:
        with self._transaction() as connection:
            count = connection.execute("SELECT COUNT(*) FROM plans").fetchone()[0]
            if request.name:
                name = request.name
            elif request.source == "sample":
                name = "示例方案"
            else:
                name = f"新建排课方案 {count + 1}"
            document = (
                sample_workspace(name)
                if request.source == "sample"
                else empty_workspace(name)
            )
            plan_id = str(uuid4())
            timestamp = _now()
            # 示例方案自带预排结果（见 sample.py），元数据直接呈现为已完成；
            # 空白方案从第一步开始。
            status, progress, last_step = (
                ("ready", 5, "preview-export")
                if request.source == "sample"
                else ("draft", 1, "input-information")
            )
            connection.execute(
                """
                INSERT INTO plans
                    (id, name, academic_year, term, status, progress, last_step,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    plan_id,
                    name,
                    request.academicYear,
                    request.term,
                    status,
                    progress,
                    last_step,
                    timestamp,
                    timestamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO plan_docs (plan_id, schema_version, rev, doc)
                VALUES (?, ?, 0, ?)
                """,
                (plan_id, CURRENT_SCHEMA_VERSION, _dump(document)),
            )
            row = connection.execute(
                "SELECT * FROM plans WHERE id = ?", (plan_id,)
            ).fetchone()
        return self._plan(row)

    def update_plan(self, plan_id: str, request: UpdatePlan) -> FlowPlan:
        changes = request.model_dump(exclude_unset=True)
        columns = {
            "name": "name",
            "academicYear": "academic_year",
            "term": "term",
            "progress": "progress",
            "status": "status",
            "lastStep": "last_step",
        }
        with self._transaction() as connection:
            self._require_plan(connection, plan_id)
            if changes:
                assignments = [f"{columns[key]} = ?" for key in changes]
                values = list(changes.values())
                assignments.append("updated_at = ?")
                values.extend([_now(), plan_id])
                connection.execute(
                    f"UPDATE plans SET {', '.join(assignments)} WHERE id = ?",
                    values,
                )
            row = connection.execute(
                "SELECT * FROM plans WHERE id = ?", (plan_id,)
            ).fetchone()
        return self._plan(row)

    def delete_plan(self, plan_id: str) -> None:
        with self._transaction() as connection:
            cursor = connection.execute(
                "DELETE FROM plans WHERE id = ?", (plan_id,)
            )
            if cursor.rowcount == 0:
                raise NotFoundError("方案不存在")

    def duplicate_plan(self, plan_id: str) -> FlowPlan:
        with self._transaction() as connection:
            source = self._require_plan(connection, plan_id)
            document, _rev = self._load_document(connection, plan_id)
            duplicate = document.model_copy(deep=True)
            duplicate.scheduleStatus = "stale"
            new_id = str(uuid4())
            timestamp = _now()
            connection.execute(
                """
                INSERT INTO plans
                    (id, name, academic_year, term, status, progress, last_step,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id,
                    f"{source['name']}（副本）",
                    source["academic_year"],
                    source["term"],
                    source["status"],
                    source["progress"],
                    source["last_step"],
                    timestamp,
                    timestamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO plan_docs (plan_id, schema_version, rev, doc)
                VALUES (?, ?, 0, ?)
                """,
                (new_id, CURRENT_SCHEMA_VERSION, _dump(duplicate)),
            )
            row = connection.execute(
                "SELECT * FROM plans WHERE id = ?", (new_id,)
            ).fetchone()
        return self._plan(row)

    def import_from(
        self, plan_id: str, source_plan_id: str, level: int
    ) -> dict[str, Any]:
        with self._transaction() as connection:
            self._require_plan(connection, plan_id)
            self._require_plan(connection, source_plan_id)
            target, rev = self._load_document(connection, plan_id)
            source, _source_rev = self._load_document(
                connection, source_plan_id
            )
            imported = target.model_copy(deep=True)
            for field in ("days", "periods", "classes"):
                setattr(imported, field, deepcopy(getattr(source, field)))
            teaching_fields = (
                "courses",
                "gradeCourses",
                "teachers",
                "matrix",
                "linked",
                "biweekly",
                "combined",
                "layered",
                "venues",
            )
            if level >= 2:
                for field in teaching_fields:
                    setattr(imported, field, deepcopy(getattr(source, field)))
            else:
                for field in teaching_fields:
                    empty = {} if field in {"gradeCourses", "matrix"} else []
                    setattr(imported, field, empty)
            imported.rules = (
                deepcopy(source.rules) if level >= 3 else []
            )
            imported.placements = []
            imported.park = []
            imported.scheduleStatus = "stale"
            self._validate_references(imported)

            undo, _redo = self._history(connection, plan_id, rev)
            undo.append((f"导入方案（第 {level} 步）", _dump(target)))
            undo = undo[-MAX_REVISIONS:]
            new_rev = rev + 1
            self._write_history(connection, plan_id, new_rev, undo, [])
            connection.execute(
                """
                UPDATE plan_docs
                SET schema_version = ?, rev = ?, doc = ?
                WHERE plan_id = ?
                """,
                (
                    CURRENT_SCHEMA_VERSION,
                    new_rev,
                    _dump(imported),
                    plan_id,
                ),
            )
            connection.execute(
                "UPDATE plans SET updated_at = ? WHERE id = ?",
                (_now(), plan_id),
            )
        return {
            "rev": new_rev,
            "doc": imported.model_dump(mode="json", exclude_none=True),
        }

    @staticmethod
    def _import_record(row: sqlite3.Row) -> ImportRecord:
        return ImportRecord(
            id=row["id"],
            kind=row["kind"],
            source=row["source"],
            summary=row["summary"],
            createdAt=row["created_at"],
        )

    def record_import(
        self, plan_id: str, request: RecordImport
    ) -> ImportRecord:
        with self._transaction() as connection:
            self._require_plan(connection, plan_id)
            cursor = connection.execute(
                """
                INSERT INTO import_history (plan_id, kind, source, summary, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    plan_id,
                    request.kind,
                    request.source,
                    request.summary,
                    _now(),
                ),
            )
            row = connection.execute(
                "SELECT * FROM import_history WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
        return self._import_record(row)

    def list_imports(self, plan_id: str) -> list[ImportRecord]:
        with self._transaction() as connection:
            self._require_plan(connection, plan_id)
            rows = connection.execute(
                """
                SELECT * FROM import_history
                WHERE plan_id = ?
                ORDER BY id DESC
                LIMIT 50
                """,
                (plan_id,),
            ).fetchall()
        return [self._import_record(row) for row in rows]

    def export_plan(self, plan_id: str) -> dict[str, str]:
        """导出完整方案快照（元数据 + 文档）为 zip，base64 编码返回。

        zip 内含 manifest.json（格式标识、版本、导出时间、FlowPlan 元数据）
        与 doc.json（Workspace 文档）。与 import-from 不同，快照保留排课结果。
        """
        with self._transaction() as connection:
            row = self._require_plan(connection, plan_id)
            document, _rev = self._load_document(connection, plan_id)
        plan = self._plan(row)
        manifest = {
            "format": PLAN_EXPORT_FORMAT,
            "formatVersion": PLAN_EXPORT_VERSION,
            "exportedAt": _now(),
            "plan": plan.model_dump(mode="json"),
        }
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "manifest.json",
                json.dumps(manifest, ensure_ascii=False, indent=2),
            )
            archive.writestr("doc.json", _dump(document))
        return {
            "fileName": f"{plan.name}.classowl.zip",
            "data": base64.b64encode(buffer.getvalue()).decode("ascii"),
        }

    def import_plan(self, name: str | None, data: str) -> FlowPlan:
        """从导出 zip 导入为新方案。文件不合法或版本不兼容时拒绝。"""
        try:
            raw = base64.b64decode(data, validate=True)
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                manifest = json.loads(archive.read("manifest.json"))
                document = Workspace.model_validate(
                    json.loads(archive.read("doc.json"))
                )
        except (
            binascii.Error,
            zipfile.BadZipFile,
            KeyError,
            ValueError,
        ) as error:
            raise InvalidPlanFileError(
                "不是有效的 ClassOwl 方案文件"
            ) from error
        if (
            manifest.get("format") != PLAN_EXPORT_FORMAT
            or manifest.get("formatVersion") != PLAN_EXPORT_VERSION
        ):
            raise InvalidPlanFileError("方案文件格式或版本不受支持")
        self._validate_references(document)

        with self._transaction() as connection:
            plan_name = (
                name or manifest.get("plan", {}).get("name") or "导入的方案"
            )
            document.schemeName = plan_name
            # 快照是完整镜像：进度、状态、最后停留步骤尽量沿用 manifest。
            meta = manifest.get("plan", {})
            step_keys = (
                "input-information",
                "arrange-teaching",
                "setting-rules",
                "adjust-schedule",
                "preview-export",
            )
            status_value = (
                meta.get("status") if meta.get("status") in ("draft", "ready") else "draft"
            )
            try:
                progress_value = min(5, max(1, int(meta.get("progress", 1))))
            except (TypeError, ValueError):
                progress_value = 1
            last_step = (
                meta.get("lastStep") if meta.get("lastStep") in step_keys else "input-information"
            )
            plan_id = str(uuid4())
            timestamp = _now()
            connection.execute(
                """
                INSERT INTO plans
                    (id, name, academic_year, term, status, progress, last_step,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    plan_id,
                    plan_name,
                    meta.get("academicYear", "2026-2027 学年"),
                    meta.get("term", "秋季学期"),
                    status_value,
                    progress_value,
                    last_step,
                    timestamp,
                    timestamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO plan_docs (plan_id, schema_version, rev, doc)
                VALUES (?, ?, 0, ?)
                """,
                (plan_id, CURRENT_SCHEMA_VERSION, _dump(document)),
            )
            row = connection.execute(
                "SELECT * FROM plans WHERE id = ?", (plan_id,)
            ).fetchone()
        return self._plan(row)

    @staticmethod
    def _validate_references(document: Workspace) -> None:
        class_ids = {item.id for item in document.classes}
        course_ids = {item.id for item in document.courses}
        teacher_ids = {item.id for item in document.teachers}

        for class_id, row in document.matrix.items():
            if class_id not in class_ids:
                raise ReferenceIntegrityError(
                    f"matrix 中的 classId {class_id} 不存在"
                )
            for course_id in row:
                if course_id not in course_ids:
                    raise ReferenceIntegrityError(
                        f"matrix 中的 courseId {course_id} 不存在"
                    )

        for grade, grade_course_ids in document.gradeCourses.items():
            for course_id in grade_course_ids:
                if course_id not in course_ids:
                    raise ReferenceIntegrityError(
                        f"gradeCourses[{grade}] 中的 courseId "
                        f"{course_id} 不存在"
                    )

        references = (
            ("classIds", class_ids),
            ("courseIds", course_ids),
            ("teacherIds", teacher_ids),
        )
        for rule in document.rules:
            for field, valid_ids in references:
                for reference_id in getattr(rule, field) or []:
                    if reference_id not in valid_ids:
                        raise ReferenceIntegrityError(
                            f"rules[{rule.id}].{field} 中的 "
                            f"{field[:-1]} {reference_id} 不存在"
                        )

    def get_document(self, plan_id: str) -> dict[str, Any]:
        with self._transaction() as connection:
            self._require_plan(connection, plan_id)
            document, rev = self._load_document(connection, plan_id)
            undo, redo = self._history(connection, plan_id, rev)
        return self._document_response(document, rev, undo, redo)

    def put_document(
        self,
        plan_id: str,
        base_rev: int,
        document: Workspace,
        checkpoint: str | None,
    ) -> dict[str, int]:
        with self._transaction() as connection:
            self._require_plan(connection, plan_id)
            current, rev = self._load_document(connection, plan_id)
            if rev != base_rev:
                raise RevisionConflictError(
                    f"文档版本已更新：baseRev={base_rev}，当前 rev={rev}"
                )
            undo, redo = self._history(connection, plan_id, rev)
            if checkpoint is not None:
                undo.append((checkpoint, _dump(current)))
                undo = undo[-MAX_REVISIONS:]
                redo = []
            new_rev = rev + 1
            self._write_history(connection, plan_id, new_rev, undo, redo)
            connection.execute(
                """
                UPDATE plan_docs
                SET schema_version = ?, rev = ?, doc = ?
                WHERE plan_id = ?
                """,
                (CURRENT_SCHEMA_VERSION, new_rev, _dump(document), plan_id),
            )
            connection.execute(
                "UPDATE plans SET updated_at = ? WHERE id = ?",
                (_now(), plan_id),
            )
        return {
            "rev": new_rev,
            "undoDepth": len(undo),
            "redoDepth": len(redo),
        }

    def undo(self, plan_id: str) -> dict[str, Any]:
        with self._transaction() as connection:
            self._require_plan(connection, plan_id)
            current, rev = self._load_document(connection, plan_id)
            undo, redo = self._history(connection, plan_id, rev)
            if not undo:
                raise RevisionConflictError("没有可撤销的操作")
            label, target = undo.pop()
            redo.insert(0, (label, _dump(current)))
            document = Workspace.model_validate_json(target)
            new_rev = rev + 1
            self._write_history(connection, plan_id, new_rev, undo, redo)
            connection.execute(
                "UPDATE plan_docs SET rev = ?, doc = ? WHERE plan_id = ?",
                (new_rev, target, plan_id),
            )
        return self._document_response(document, new_rev, undo, redo, False)

    def redo(self, plan_id: str) -> dict[str, Any]:
        with self._transaction() as connection:
            self._require_plan(connection, plan_id)
            current, rev = self._load_document(connection, plan_id)
            undo, redo = self._history(connection, plan_id, rev)
            if not redo:
                raise RevisionConflictError("没有可重做的操作")
            label, target = redo.pop(0)
            undo.append((label, _dump(current)))
            document = Workspace.model_validate_json(target)
            new_rev = rev + 1
            self._write_history(connection, plan_id, new_rev, undo, redo)
            connection.execute(
                "UPDATE plan_docs SET rev = ?, doc = ? WHERE plan_id = ?",
                (new_rev, target, plan_id),
            )
        return self._document_response(document, new_rev, undo, redo, False)

    @staticmethod
    def _require_plan(
        connection: sqlite3.Connection, plan_id: str
    ) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM plans WHERE id = ?", (plan_id,)
        ).fetchone()
        if row is None:
            raise NotFoundError("方案不存在")
        return row

    def _load_document(
        self, connection: sqlite3.Connection, plan_id: str
    ) -> tuple[Workspace, int]:
        row = connection.execute(
            "SELECT schema_version, rev, doc FROM plan_docs WHERE plan_id = ?",
            (plan_id,),
        ).fetchone()
        if row is None:
            raise NotFoundError("方案文档不存在")
        version = row["schema_version"]
        if version > CURRENT_SCHEMA_VERSION:
            raise FutureSchemaError(
                f"文档 schema_version {version} 高于当前支持版本 "
                f"{CURRENT_SCHEMA_VERSION}，拒绝打开"
            )
        raw = json.loads(row["doc"])
        while version < CURRENT_SCHEMA_VERSION:
            migration = MIGRATIONS.get(version)
            if migration is None:
                raise MigrationError(
                    f"缺少 schema_version {version} 到 {version + 1} 的迁移"
                )
            raw = migration(raw)
            version += 1
        document = Workspace.model_validate(raw)
        if version != row["schema_version"]:
            connection.execute(
                """
                UPDATE plan_docs SET schema_version = ?, doc = ?
                WHERE plan_id = ?
                """,
                (version, _dump(document), plan_id),
            )
        return document, row["rev"]

    @staticmethod
    def _history(
        connection: sqlite3.Connection, plan_id: str, rev: int
    ) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
        rows = connection.execute(
            """
            SELECT seq, label, doc FROM plan_revisions
            WHERE plan_id = ? ORDER BY seq
            """,
            (plan_id,),
        ).fetchall()
        undo = [(row["label"], row["doc"]) for row in rows if row["seq"] < rev]
        redo = [(row["label"], row["doc"]) for row in rows if row["seq"] > rev]
        return undo, redo

    @staticmethod
    def _write_history(
        connection: sqlite3.Connection,
        plan_id: str,
        rev: int,
        undo: list[tuple[str, str]],
        redo: list[tuple[str, str]],
    ) -> None:
        if len(undo) + len(redo) > MAX_REVISIONS:
            undo = undo[-(MAX_REVISIONS - len(redo)) :]
        connection.execute(
            "DELETE FROM plan_revisions WHERE plan_id = ?", (plan_id,)
        )
        first_undo_seq = rev - len(undo)
        rows = [
            (plan_id, first_undo_seq + index, label, doc)
            for index, (label, doc) in enumerate(undo)
        ]
        rows.extend(
            (plan_id, rev + index + 1, label, doc)
            for index, (label, doc) in enumerate(redo)
        )
        connection.executemany(
            """
            INSERT INTO plan_revisions (plan_id, seq, label, doc)
            VALUES (?, ?, ?, ?)
            """,
            rows,
        )

    @staticmethod
    def _document_response(
        document: Workspace,
        rev: int,
        undo: list[tuple[str, str]],
        redo: list[tuple[str, str]],
        include_schema: bool = True,
    ) -> dict[str, Any]:
        response: dict[str, Any] = {
            "rev": rev,
            "doc": document.model_dump(mode="json", exclude_none=True),
            "undoDepth": len(undo),
            "redoDepth": len(redo),
        }
        if include_schema:
            response["schemaVersion"] = CURRENT_SCHEMA_VERSION
        return response
