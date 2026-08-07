from __future__ import annotations

import asyncio
import os
import secrets
from pathlib import Path

import ortools
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

#: renderer 在生产环境的源。开发环境的 vite dev server 由 CLASSOWL_DEV_ORIGIN 覆盖。
ALLOWED_ORIGIN = os.environ.get("CLASSOWL_DEV_ORIGIN", "classowl://app")

from . import __version__
from .exports import ExportRequest, ExportService
from .models import (
    CreatePlan,
    ImportFrom,
    ImportPlanFile,
    PutDocument,
    RecordImport,
    UpdatePlan,
)
from .solver import AlreadyRunningError, SolveRequest, SolverService
from .storage import (
    CURRENT_SCHEMA_VERSION,
    DocumentStore,
    FutureSchemaError,
    InvalidPlanFileError,
    MigrationError,
    NotFoundError,
    ReferenceIntegrityError,
    RevisionConflictError,
)


def create_app(token: str, data_dir: Path) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = DocumentStore(data_dir)
    app.state.solver = SolverService(app.state.store)
    app.state.exports = ExportService(app.state.store)

    # renderer 的源是 classowl://app，对 127.0.0.1 的请求算跨源，
    # 浏览器会先发不带自定义头的 OPTIONS 预检——预检不能要求令牌，否则必然 401。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[ALLOWED_ORIGIN],
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["X-ClassOwl-Token", "Content-Type"],
    )

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)
        presented = request.headers.get("X-ClassOwl-Token", "")
        if not secrets.compare_digest(presented, token):
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        return await call_next(request)

    @app.exception_handler(NotFoundError)
    async def not_found(_request: Request, error: NotFoundError):
        return JSONResponse(status_code=404, content={"detail": str(error)})

    @app.exception_handler(RevisionConflictError)
    async def conflict(_request: Request, error: RevisionConflictError):
        return JSONResponse(status_code=409, content={"detail": str(error)})

    @app.exception_handler(FutureSchemaError)
    async def future_schema(_request: Request, error: FutureSchemaError):
        return JSONResponse(status_code=409, content={"detail": str(error)})

    @app.exception_handler(MigrationError)
    async def migration_error(_request: Request, error: MigrationError):
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @app.exception_handler(ReferenceIntegrityError)
    async def reference_integrity(
        _request: Request, error: ReferenceIntegrityError
    ):
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @app.exception_handler(InvalidPlanFileError)
    async def invalid_plan_file(_request: Request, error: InvalidPlanFileError):
        return JSONResponse(status_code=400, content={"detail": str(error)})

    @app.get("/api/v1/system/status")
    async def system_status() -> dict[str, object]:
        return {
            "backendVersion": __version__,
            "protocolVersion": 1,
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "dataDir": str(data_dir),
            "ortoolsVersion": ortools.__version__,
        }

    @app.post("/api/v1/system/exit")
    async def exit_sidecar(request: Request) -> dict[str, bool]:
        server = getattr(request.app.state, "server", None)
        if server is not None:
            asyncio.get_running_loop().call_soon(
                setattr, server, "should_exit", True
            )
        return {"ok": True}

    @app.get("/api/v1/plans")
    async def list_plans():
        return app.state.store.list_plans()

    @app.post("/api/v1/plans", status_code=status.HTTP_201_CREATED)
    async def create_plan(request: CreatePlan | None = None):
        return app.state.store.create_plan(request or CreatePlan())

    @app.patch("/api/v1/plans/{plan_id}")
    async def update_plan(plan_id: str, request: UpdatePlan):
        return app.state.store.update_plan(plan_id, request)

    @app.delete(
        "/api/v1/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT
    )
    async def delete_plan(plan_id: str):
        app.state.store.delete_plan(plan_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post(
        "/api/v1/plans/{plan_id}/duplicate",
        status_code=status.HTTP_201_CREATED,
    )
    async def duplicate_plan(plan_id: str):
        return app.state.store.duplicate_plan(plan_id)

    @app.post("/api/v1/plans/{plan_id}/import-from")
    async def import_from(plan_id: str, request: ImportFrom):
        return app.state.store.import_from(
            plan_id, request.sourcePlanId, request.level
        )

    @app.get("/api/v1/plans/{plan_id}/export")
    async def export_plan(plan_id: str):
        return app.state.store.export_plan(plan_id)

    @app.post("/api/v1/plans/import", status_code=status.HTTP_201_CREATED)
    async def import_plan(request: ImportPlanFile):
        return app.state.store.import_plan(request.name, request.data)

    @app.get("/api/v1/plans/{plan_id}/imports")
    async def list_imports(plan_id: str):
        return app.state.store.list_imports(plan_id)

    @app.post(
        "/api/v1/plans/{plan_id}/imports",
        status_code=status.HTTP_201_CREATED,
    )
    async def record_import(plan_id: str, request: RecordImport):
        return app.state.store.record_import(plan_id, request)

    @app.get("/api/v1/plans/{plan_id}/doc")
    async def get_document(plan_id: str):
        return app.state.store.get_document(plan_id)

    @app.put("/api/v1/plans/{plan_id}/doc")
    async def put_document(plan_id: str, request: PutDocument):
        return app.state.store.put_document(
            plan_id, request.baseRev, request.doc, request.checkpoint
        )

    @app.post("/api/v1/plans/{plan_id}/undo")
    async def undo(plan_id: str):
        return app.state.store.undo(plan_id)

    @app.post("/api/v1/plans/{plan_id}/redo")
    async def redo(plan_id: str):
        return app.state.store.redo(plan_id)

    @app.post(
        "/api/v1/plans/{plan_id}/solve",
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def solve(plan_id: str, request: SolveRequest | None = None):
        request = request or SolveRequest()
        try:
            job = app.state.solver.start(
                plan_id,
                min(
                    600,
                    max(1, request.timeLimitSeconds),
                ),
                request.keepExisting,
            )
        except AlreadyRunningError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return {"jobId": job.id}

    @app.get("/api/v1/solver/{job_id}")
    async def get_solver_job(job_id: str):
        return app.state.solver.get(job_id).response()

    @app.post("/api/v1/solver/{job_id}/cancel")
    async def cancel_solver_job(job_id: str):
        app.state.solver.cancel(job_id)
        return {"ok": True}

    @app.post(
        "/api/v1/plans/{plan_id}/exports",
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def export_plan(plan_id: str, request: ExportRequest):
        job = app.state.exports.start(
            plan_id, request.format, request.options, request.targetPath
        )
        return {"jobId": job.id}

    @app.get("/api/v1/exports/{job_id}")
    async def get_export_job(job_id: str):
        return app.state.exports.get(job_id).response()

    return app
