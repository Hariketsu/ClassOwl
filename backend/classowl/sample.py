"""内置示例方案数据。

与前端 `frontend/src/workspace.ts` 的 `createDemoWorkspace()` 同源：
10 名教师、一/二年级共 5 个班、13 门课程，课时需求约 125 / 容量 150，
附带连堂、单双周与 4 条排课条件，保证 CP-SAT 真实可解。

示例自带一份预排好的完整结果（placements 来自
`sample_result.py` 中固化的 fixture，由 `scripts/make_sample_result.py`
用真实求解器离线生成，创建时不跑求解器）。用户仍可在 Step4
一键删除自动排课后重排。

一处有意的偏离：前端演示里 c2 的少先队活动由 t1（王芳）任教，
但 t1 兼任一年级三个班的语文/写字/少先队，负载 31 节 > 30 个课位，
必然有 1 节排不下。这里把 c2 的少先队改由 t7 任教，
使示例数据本身零硬冲突。
"""

from __future__ import annotations

from .models import (
    BiweeklyRule,
    Cell,
    Course,
    Day,
    LinkedRule,
    MatrixCell,
    Period,
    Placement,
    ScheduleRule,
    SchoolClass,
    Teacher,
    Workspace,
)
from .sample_result import SAMPLE_PLACEMENTS

DAYS = [
    Day(id=1, label="星期一", short="一"),
    Day(id=2, label="星期二", short="二"),
    Day(id=3, label="星期三", short="三"),
    Day(id=4, label="星期四", short="四"),
    Day(id=5, label="星期五", short="五"),
]

PERIODS = [
    Period(id=1, label="1节", band="上午", start="08:00", end="08:40"),
    Period(id=2, label="2节", band="上午", start="08:50", end="09:30"),
    Period(id=3, label="3节", band="上午", start="10:00", end="10:40"),
    Period(id=4, label="4节", band="上午", start="10:50", end="11:30"),
    Period(id=5, label="5节", band="下午", start="14:00", end="14:40"),
    Period(id=6, label="6节", band="下午", start="14:50", end="15:30"),
]

_TEACHER_NAMES = ["王芳", "李强", "陈静", "赵磊", "周敏", "孙悦", "马超", "林雪", "何平", "郑凯"]

_CLASSES = [
    SchoolClass(id="c1", grade="一年级", name="1班", room="101"),
    SchoolClass(id="c2", grade="一年级", name="2班", room="102"),
    SchoolClass(id="c3", grade="一年级", name="3班", room="103"),
    SchoolClass(id="c4", grade="二年级", name="1班", room="201"),
    SchoolClass(id="c5", grade="二年级", name="2班", room="202"),
]

_COURSES_G1 = [
    Course(id="k1", name="班会", biweekly=False),
    Course(id="k2", name="写字", biweekly=False),
    Course(id="k3", name="语文", biweekly=False),
    Course(id="k4", name="数学", biweekly=False),
    Course(id="k5", name="道德与法治", biweekly=False),
    Course(id="k6", name="体育与健康", biweekly=False),
    Course(id="k7", name="音乐", biweekly=True),
    Course(id="k8", name="美术", biweekly=True),
    Course(id="k9", name="少先队活动", biweekly=False),
    Course(id="k10", name="劳动教育", biweekly=False),
    Course(id="k11", name="红色文化", biweekly=False),
    Course(id="k12", name="数学测试", biweekly=False),
]

_COURSES_G2 = [
    Course(id="k1", name="班会", biweekly=False),
    Course(id="k2", name="写字", biweekly=False),
    Course(id="k3", name="语文", biweekly=False),
    Course(id="k4", name="数学", biweekly=False),
    Course(id="k13", name="科学", biweekly=False),
    Course(id="k5", name="道德与法治", biweekly=False),
    Course(id="k6", name="体育与健康", biweekly=False),
    Course(id="k7", name="音乐", biweekly=False),
    Course(id="k8", name="美术", biweekly=False),
    Course(id="k9", name="少先队活动", biweekly=False),
    Course(id="k10", name="劳动教育", biweekly=False),
    Course(id="k11", name="红色文化", biweekly=False),
]

_G1_HOURS = {"k1": 0, "k2": 1, "k3": 8, "k4": 4, "k5": 2, "k6": 2, "k7": 1, "k8": 1, "k9": 1, "k10": 1, "k11": 1, "k12": 3}
_G1_TEACHERS = {"k1": "t1", "k2": "t1", "k3": "t1", "k4": "t2", "k5": "t3", "k6": "t4", "k7": "t5", "k8": "t6", "k9": "t1", "k10": "t7", "k11": "t7", "k12": "t2"}
_G2_HOURS = {"k1": 0, "k2": 1, "k3": 8, "k4": 4, "k13": 1, "k5": 1, "k6": 2, "k7": 2, "k8": 2, "k9": 1, "k10": 1, "k11": 1}
_G2_TEACHERS = {"k1": "t8", "k2": "t8", "k3": "t8", "k4": "t9", "k13": "t10", "k5": "t3", "k6": "t4", "k7": "t5", "k8": "t6", "k9": "t8", "k10": "t7", "k11": "t7"}


def sample_workspace(name: str) -> Workspace:
    teachers = [Teacher(id=f"t{index + 1}", name=teacher) for index, teacher in enumerate(_TEACHER_NAMES)]

    course_map: dict[str, Course] = {}
    for course in [*_COURSES_G1, *_COURSES_G2]:
        course_map[course.id] = course
    courses = list(course_map.values())

    grade_courses = {
        "一年级": [course.id for course in _COURSES_G1],
        "二年级": [course.id for course in _COURSES_G2],
        "三年级": [course.id for course in _COURSES_G2],
        "四年级": [course.id for course in _COURSES_G2],
        "五年级": [course.id for course in _COURSES_G2],
        "六年级": [course.id for course in _COURSES_G2],
    }

    matrix: dict[str, dict[str, MatrixCell]] = {}
    for school_class in _CLASSES:
        is_g1 = school_class.grade == "一年级"
        hours = _G1_HOURS if is_g1 else _G2_HOURS
        teacher_map = _G1_TEACHERS if is_g1 else _G2_TEACHERS
        matrix[school_class.id] = {
            course_id: MatrixCell(hours=value, teacherId=teacher_map.get(course_id, ""))
            for course_id, value in hours.items()
        }
    matrix["c1"]["k1"].hours = 1
    matrix["c4"]["k1"].hours = 1
    # 见模块 docstring：t1 负载 31 > 30，c2 少先队改由 t7 任教。
    matrix["c2"]["k9"].teacherId = "t7"

    all_class_ids = [school_class.id for school_class in _CLASSES]
    rules = [
        ScheduleRule(
            id="r1", type="禁排", enabled=True, note="体育不排早上第一节",
            subjectMode="course", courseIds=["k6"], classIds=all_class_ids, teacherIds=[],
            cells=[Cell(dayId=day.id, periodId=1) for day in DAYS],
            summary="各班体育与健康，星期一至五第1节，不排课",
        ),
        ScheduleRule(
            id="r2", type="必排", enabled=True, note="班会固定周一最后一节",
            subjectMode="course", courseIds=["k1"], classIds=all_class_ids, teacherIds=[],
            cells=[Cell(dayId=1, periodId=6)],
            summary="各班班会，星期一第6节，必排课",
        ),
        ScheduleRule(
            id="r3", type="课程优先排", enabled=True, note="语文优先上午",
            subjectMode="course", courseIds=["k3"], classIds=all_class_ids, teacherIds=[],
            periodIds=[1, 2, 3, 4],
            summary="语文优先第1–4节",
        ),
        ScheduleRule(
            id="r4", type="各天限制", enabled=True, note="语文每天至少一节",
            subjectMode="course", courseIds=["k3"], classIds=all_class_ids, teacherIds=[],
            dayIds=[1, 2, 3, 4, 5], limitType="最少", limitCount=1,
            summary="语文周一至周五最少 1 节",
        ),
    ]

    return Workspace(
        schemeName=name,
        days=[day.model_copy() for day in DAYS],
        periods=[period.model_copy() for period in PERIODS],
        teachers=teachers,
        classes=[school_class.model_copy() for school_class in _CLASSES],
        courses=courses,
        gradeCourses=grade_courses,
        matrix=matrix,
        linked=[LinkedRule(id="lk1", courseId="k3", classIds=["c1", "c2", "c3"], timesPerWeek=1, consecutive=2)],
        biweekly=[BiweeklyRule(id="bw1", courseA="k7", courseB="k8", classIds=["c1", "c2", "c3"], oddCourseId="k7")],
        combined=[],
        layered=[],
        venues=[],
        rules=rules,
        placements=[Placement(**placement) for placement in SAMPLE_PLACEMENTS],
        park=[],
        scheduleStatus="ready",
    )
