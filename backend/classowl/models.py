from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


Band = Literal["早晨", "上午", "下午", "晚上"]
RuleType = Literal[
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
LimitType = Literal["最多", "最少", "固定"]
AlignStrength = Literal["优先满足", "尽量满足", ""]
PlacementSource = Literal["auto", "manual"]
ScheduleStatus = Literal["empty", "ready", "stale"]
FlowStepKey = Literal[
    "input-information",
    "arrange-teaching",
    "setting-rules",
    "adjust-schedule",
    "preview-export",
]


class Day(Model):
    id: int
    label: str
    short: str


class Period(Model):
    id: int
    label: str
    band: Band
    start: str
    end: str


class SchoolClass(Model):
    id: str
    grade: str
    name: str
    room: str


class Course(Model):
    id: str
    name: str
    biweekly: bool


class Teacher(Model):
    id: str
    name: str


class MatrixCell(Model):
    hours: int
    teacherId: str


class LinkedRule(Model):
    id: str
    courseId: str
    classIds: list[str]
    timesPerWeek: int
    consecutive: int


class BiweeklyRule(Model):
    id: str
    courseA: str
    courseB: str
    classIds: list[str]
    oddCourseId: str


class CombinedRule(Model):
    id: str
    courseId: str
    classIds: list[str]


class LayeredRule(Model):
    id: str
    courseId: str
    classId: str
    name: str
    teacherId: str


class VenueRule(Model):
    id: str
    name: str
    capacity: int
    courseIds: list[str]


class Cell(Model):
    dayId: int
    periodId: int


class ScheduleRule(Model):
    id: str
    type: RuleType
    enabled: bool
    note: str
    summary: str
    subjectMode: Literal["course", "teacher"] | None = None
    courseIds: list[str] | None = None
    classIds: list[str] | None = None
    teacherIds: list[str] | None = None
    cells: list[Cell] | None = None
    periodIds: list[int] | None = None
    dayIds: list[int] | None = None
    limitType: LimitType | None = None
    limitCount: int | None = None
    periodA: int | None = None
    periodB: int | None = None
    relFrom: list[str] | None = None
    relTo: list[str] | None = None
    align: dict[str, AlignStrength] | None = None


class Placement(Model):
    id: str
    classId: str
    courseId: str
    teacherId: str
    dayId: int
    periodId: int
    source: PlacementSource
    locked: bool


class ParkItem(Model):
    id: str
    classId: str
    courseId: str
    teacherId: str
    source: PlacementSource
    locked: bool | None = None


class Workspace(Model):
    schemeName: str
    days: list[Day]
    periods: list[Period]
    teachers: list[Teacher]
    classes: list[SchoolClass]
    courses: list[Course]
    gradeCourses: dict[str, list[str]]
    matrix: dict[str, dict[str, MatrixCell]]
    linked: list[LinkedRule]
    biweekly: list[BiweeklyRule]
    combined: list[CombinedRule]
    layered: list[LayeredRule]
    venues: list[VenueRule]
    rules: list[ScheduleRule]
    placements: list[Placement]
    park: list[ParkItem]
    scheduleStatus: ScheduleStatus


class FlowPlan(Model):
    id: str
    name: str
    academicYear: str
    term: str
    updatedAt: str
    progress: int
    status: Literal["draft", "ready"]
    lastStep: FlowStepKey


class CreatePlan(Model):
    name: str | None = None
    academicYear: str = "2026-2027 学年"
    term: str = "秋季学期"
    source: Literal["blank", "sample"] = "blank"


class UpdatePlan(Model):
    name: str | None = None
    academicYear: str | None = None
    term: str | None = None
    progress: int | None = Field(default=None, ge=1, le=5)
    status: Literal["draft", "ready"] | None = None
    lastStep: FlowStepKey | None = None


class PutDocument(Model):
    baseRev: int
    doc: Workspace
    checkpoint: str | None


class ImportFrom(Model):
    sourcePlanId: str
    level: Literal[1, 2, 3]


class ImportPlanFile(Model):
    """方案导出 zip 的 base64 载荷。name 缺省时沿用 manifest 里的方案名。"""

    name: str | None = None
    data: str


ImportKind = Literal["teaching", "plan"]


class RecordImport(Model):
    """记录一次导入动作（步骤2 粘贴导入任课 / 从其他方案导入），用于导入历史。"""

    kind: ImportKind
    source: str
    summary: str


class ImportRecord(Model):
    id: int
    kind: ImportKind
    source: str
    summary: str
    createdAt: str


def empty_workspace(name: str) -> Workspace:
    return Workspace(
        schemeName=name,
        days=[],
        periods=[],
        teachers=[],
        classes=[],
        courses=[],
        gradeCourses={},
        matrix={},
        linked=[],
        biweekly=[],
        combined=[],
        layered=[],
        venues=[],
        rules=[],
        placements=[],
        park=[],
        scheduleStatus="empty",
    )
