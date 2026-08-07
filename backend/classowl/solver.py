from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import uuid4

from ortools.sat.python import cp_model
from pydantic import BaseModel, ConfigDict

from .storage import DocumentStore, NotFoundError


ACTIVE_STATUSES = {"queued", "running"}


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    timeLimitSeconds: int = 30
    keepExisting: bool = False


class AlreadyRunningError(Exception):
    pass


def _rule_applies_to_task(
    rule: dict[str, Any], task: tuple[str, str, str, int]
) -> bool:
    class_id, course_id, teacher_id, _hours = task
    if rule.get("subjectMode") == "teacher":
        return teacher_id in (rule.get("teacherIds") or [])
    return (
        (not rule.get("courseIds") or course_id in rule["courseIds"])
        and (not rule.get("classIds") or class_id in rule["classIds"])
    )


def _infeasible_diagnostics(
    document: dict[str, Any],
    slots: list[tuple[int, int]],
    tasks: list[tuple[str, str, str, int]],
    enabled_rules: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    total_hours = sum(task[3] for task in tasks)
    total_capacity = len(document["classes"]) * len(slots)
    if total_hours > total_capacity:
        shortage = total_hours - total_capacity
        diagnostics.append(
            {
                "text": (
                    f"总课时需求 {total_hours} 节超过总课位容量 "
                    f"{total_capacity} 节，缺少 {shortage} 个课位；"
                    "建议增加节次或减少课时"
                )
            }
        )
    class_names = {
        school_class["id"]: (
            f"{school_class['grade']}{school_class['name']}"
        )
        for school_class in document["classes"]
    }
    for class_id in class_names:
        class_hours = sum(task[3] for task in tasks if task[0] == class_id)
        if class_hours > len(slots):
            diagnostics.append(
                {
                    "text": (
                        f"{class_names[class_id]}课时需求 {class_hours} 节"
                        f"超过可用课位 {len(slots)} 节，缺少 "
                        f"{class_hours - len(slots)} 个课位；"
                        "建议增加节次或减少该班课时"
                    )
                }
            )
    teacher_names = {
        teacher["id"]: teacher["name"] for teacher in document["teachers"]
    }
    for teacher_id, teacher_name in teacher_names.items():
        teacher_hours = sum(
            task[3] for task in tasks if task[2] == teacher_id
        )
        if teacher_hours > len(slots):
            diagnostics.append(
                {
                    "text": (
                        f"{teacher_name}总课时 {teacher_hours} 节超过"
                        f"教师可用课位 {len(slots)} 节，缺少 "
                        f"{teacher_hours - len(slots)} 个课位；"
                        "建议调整任课教师或减少课时"
                    )
                }
            )
    course_names = {
        course["id"]: course["name"] for course in document["courses"]
    }
    day_names = {day["id"]: day["label"] for day in document["days"]}
    valid_slots = set(slots)
    must_rules = [rule for rule in enabled_rules if rule["type"] == "必排"]
    ban_rules = [rule for rule in enabled_rules if rule["type"] == "禁排"]
    for must_rule in must_rules:
        for ban_rule in ban_rules:
            common_cells = [
                cell
                for cell in (must_rule.get("cells") or [])
                if cell in (ban_rule.get("cells") or [])
                if (cell["dayId"], cell["periodId"]) in valid_slots
            ]
            for task in tasks:
                if not (
                    task[1] in (must_rule.get("courseIds") or [])
                    and (
                        not must_rule.get("classIds")
                        or task[0] in must_rule["classIds"]
                    )
                    and _rule_applies_to_task(ban_rule, task)
                ):
                    continue
                for cell in common_cells:
                    diagnostics.append(
                        {
                            "text": (
                                f"必排规则「{must_rule.get('note') or must_rule['id']}」"
                                f"与禁排规则「{ban_rule.get('note') or ban_rule['id']}」"
                                f"冲突：{class_names.get(task[0], task[0])}"
                                f"「{course_names.get(task[1], task[1])}」"
                                f"在{day_names.get(cell['dayId'], cell['dayId'])}"
                                f"第{cell['periodId']}节既必排又禁排；"
                                "建议停用或修改其中一条规则"
                            )
                        }
                    )
    for task in tasks:
        must_cells = {
            (cell["dayId"], cell["periodId"])
            for rule in must_rules
            if task[1] in (rule.get("courseIds") or [])
            if not rule.get("classIds") or task[0] in rule["classIds"]
            for cell in (rule.get("cells") or [])
            if (cell["dayId"], cell["periodId"]) in valid_slots
        }
        if len(must_cells) > task[3]:
            diagnostics.append(
                {
                    "text": (
                        f"{class_names.get(task[0], task[0])}"
                        f"「{course_names.get(task[1], task[1])}」"
                        f"只有 {task[3]} 课时，但设置了 "
                        f"{len(must_cells)} 个必排位置；"
                        "建议减少必排位置或增加课时"
                    )
                }
            )
    margin = total_capacity - total_hours
    if (
        enabled_rules
        and total_capacity
        and 0 <= margin < total_capacity * 0.05
    ):
        diagnostics.append(
            {
                "text": (
                    f"课位余量 {margin}/{total_capacity}"
                    f"（{margin / total_capacity:.1%}）不足，"
                    "规则难以同时满足；建议增加课位、减少课时"
                    "或停用部分规则"
                ),
                "soft": True,
            }
        )
    return diagnostics


@dataclass
class SolverJob:
    id: str
    plan_id: str
    status: Literal[
        "queued", "running", "done", "infeasible", "cancelled", "error"
    ] = "queued"
    progress: int = 0
    message: str = "等待求解"
    result: dict[str, Any] | None = None
    cancel_event: threading.Event = field(
        default_factory=threading.Event, repr=False
    )
    engine: cp_model.CpSolver | None = field(default=None, repr=False)

    def response(self) -> dict[str, Any]:
        response = {
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
        }
        if self.result is not None:
            response["result"] = self.result
        return response


class SolverService:
    def __init__(self, store: DocumentStore):
        self.store = store
        self.jobs: dict[str, SolverJob] = {}
        self._lock = threading.Lock()

    def start(
        self, plan_id: str, seconds: int, keep_existing: bool = False
    ) -> SolverJob:
        document = self.store.get_document(plan_id)["doc"]
        with self._lock:
            if any(
                job.plan_id == plan_id and job.status in ACTIVE_STATUSES
                for job in self.jobs.values()
            ):
                raise AlreadyRunningError("该方案已有排课任务正在运行")
            job = SolverJob(id=str(uuid4()), plan_id=plan_id)
            self.jobs[job.id] = job
        threading.Thread(
            target=self._solve,
            args=(job, document, seconds, keep_existing),
            daemon=True,
        ).start()
        return job

    def get(self, job_id: str) -> SolverJob:
        try:
            return self.jobs[job_id]
        except KeyError as error:
            raise NotFoundError("求解任务不存在") from error

    def cancel(self, job_id: str) -> None:
        job = self.get(job_id)
        job.cancel_event.set()
        if job.engine is not None:
            job.engine.stop_search()
        with self._lock:
            job.status = "cancelled"
            job.progress = 100
            job.message = "已取消"

    def _solve(
        self,
        job: SolverJob,
        document: dict[str, Any],
        seconds: int,
        keep_existing: bool,
    ) -> None:
        with self._lock:
            if job.cancel_event.is_set():
                return
            job.status = "running"
            job.progress = 10
            job.message = "正在生成课程表"
        try:
            slots = [
                (day["id"], period["id"])
                for day in document["days"]
                for period in document["periods"]
            ]
            tasks = [
                (class_id, course_id, cell["teacherId"], cell["hours"])
                for class_id, row in document["matrix"].items()
                for course_id, cell in row.items()
                if cell["hours"] > 0
            ]
            enabled_rules = [
                rule
                for rule in document["rules"]
                if rule["enabled"] is not False
            ]
            infeasible_diagnostics = _infeasible_diagnostics(
                document, slots, tasks, enabled_rules
            )
            model = cp_model.CpModel()
            variables = {
                (task_index, slot_index): model.new_bool_var(
                    f"t{task_index}s{slot_index}"
                )
                for task_index in range(len(tasks))
                for slot_index in range(len(slots))
            }
            task_indexes = {
                (task[0], task[1]): index for index, task in enumerate(tasks)
            }
            slot_indexes = {slot: index for index, slot in enumerate(slots)}
            banned_variable_keys = {
                (task_index, slot_index)
                for task_index, (class_id, course_id, teacher_id, _hours)
                in enumerate(tasks)
                for slot_index, (day_id, period_id) in enumerate(slots)
                if any(
                    rule["type"] == "禁排"
                    and {"dayId": day_id, "periodId": period_id}
                    in (rule.get("cells") or [])
                    and _rule_applies_to_task(
                        rule,
                        (class_id, course_id, teacher_id, _hours),
                    )
                    for rule in enabled_rules
                )
            }
            requested_must_variable_keys = {
                (
                    task_indexes[class_id, course_id],
                    slot_indexes[cell["dayId"], cell["periodId"]],
                )
                for rule in enabled_rules
                if rule["type"] == "必排"
                for class_id in (
                    rule.get("classIds")
                    or [school_class["id"] for school_class in document["classes"]]
                )
                for course_id in (rule.get("courseIds") or [])
                for cell in (rule.get("cells") or [])
                if (class_id, course_id) in task_indexes
                if (cell["dayId"], cell["periodId"]) in slot_indexes
            }
            fixed_placements = [
                placement
                for placement in document["placements"]
                if keep_existing or placement["locked"]
            ]
            fixed_variables = {
                (
                    task_indexes[
                        (placement["classId"], placement["courseId"])
                    ],
                    slot_indexes[
                        (placement["dayId"], placement["periodId"])
                    ],
                ): placement
                for placement in fixed_placements
                if (placement["classId"], placement["courseId"])
                in task_indexes
                if (placement["dayId"], placement["periodId"])
                in slot_indexes
            }
            rule_unmet = [
                {
                    "text": (
                        f"{tasks[task_index][0]} 的 {tasks[task_index][1]} "
                        f"必排位置周{slots[slot_index][0]}第"
                        f"{slots[slot_index][1]}节与禁排冲突，未能满足"
                    )
                }
                for task_index, slot_index in sorted(
                    requested_must_variable_keys & banned_variable_keys
                )
            ] + [
                {
                    "text": (
                        f"{placement['classId']} 的 "
                        f"{placement['courseId']} 现有课表项周"
                        f"{placement['dayId']}第"
                        f"{placement['periodId']}节违反禁排条件，已保留"
                    )
                }
                for variable_key, placement in fixed_variables.items()
                if keep_existing and variable_key in banned_variable_keys
            ]
            must_variable_keys: set[tuple[int, int]] = set()
            for task_index, (*_ids, hours) in enumerate(tasks):
                occupied = {
                    key
                    for key in fixed_variables
                    if key[0] == task_index
                }
                for variable_key in sorted(
                    requested_must_variable_keys - banned_variable_keys
                ):
                    if variable_key[0] != task_index:
                        continue
                    if variable_key in occupied or len(occupied) < hours:
                        must_variable_keys.add(variable_key)
                        occupied.add(variable_key)
                    else:
                        slot_index = variable_key[1]
                        rule_unmet.append(
                            {
                                "text": (
                                    f"{tasks[task_index][0]} 的 "
                                    f"{tasks[task_index][1]} 必排位置周"
                                    f"{slots[slot_index][0]}第"
                                    f"{slots[slot_index][1]}节超过"
                                    f"{hours}课时，未能满足"
                                )
                            }
                        )
            park_variables = {
                task_index: model.new_int_var(0, task[3], f"t{task_index}park")
                for task_index, task in enumerate(tasks)
            }
            for task_index, (*_ids, hours) in enumerate(tasks):
                if keep_existing:
                    existing_count = sum(
                        placement["classId"] == tasks[task_index][0]
                        and placement["courseId"] == tasks[task_index][1]
                        for placement in fixed_placements
                    )
                    remaining = max(0, hours - existing_count)
                    model.add(
                        sum(
                            variables[task_index, slot_index]
                            for slot_index in range(len(slots))
                            if (task_index, slot_index)
                            not in fixed_variables
                        )
                        + park_variables[task_index]
                        == remaining
                    )
                else:
                    model.add(
                        sum(
                            variables[task_index, slot_index]
                            for slot_index in range(len(slots))
                        )
                        + park_variables[task_index]
                        == hours
                    )
            for variable_key in fixed_variables:
                model.add(variables[variable_key] == 1)
            for variable_key in (
                banned_variable_keys - set(fixed_variables)
                if keep_existing
                else banned_variable_keys
            ):
                model.add(variables[variable_key] == 0)
            for variable_key in must_variable_keys:
                model.add(variables[variable_key] == 1)
            hard_violations: list[
                tuple[cp_model.IntVar, str]
            ] = []
            soft_alignments: list[
                tuple[list[cp_model.IntVar], int, str, int]
            ] = []
            preferred_courses: list[
                tuple[list[cp_model.IntVar], str]
            ] = []
            limit_violations: list[
                tuple[
                    cp_model.IntVar,
                    cp_model.IntVar,
                    str,
                    str,
                    str,
                    int,
                ]
            ] = []
            aligned_teacher_courses = {
                tuple(key.split("|", 1))
                for rule in enabled_rules
                if rule["type"] == "教案齐头"
                for key, strength in (rule.get("align") or {}).items()
                if strength in {"优先满足", "尽量满足"}
                and "|" in key
            }
            for slot_index in range(len(slots)):
                for class_id in {task[0] for task in tasks}:
                    model.add_at_most_one(
                        variables[task_index, slot_index]
                        for task_index, task in enumerate(tasks)
                        if task[0] == class_id
                    )
                for teacher_id in {task[2] for task in tasks if task[2]}:
                    occupied = []
                    for course_id in {
                        task[1] for task in tasks if task[2] == teacher_id
                    }:
                        course_variables = [
                            variables[task_index, slot_index]
                            for task_index, task in enumerate(tasks)
                            if task[1] == course_id
                            and task[2] == teacher_id
                        ]
                        if (
                            teacher_id,
                            course_id,
                        ) not in aligned_teacher_courses:
                            occupied.extend(course_variables)
                            continue
                        active = model.new_bool_var(
                            f"aligned_teacher_{teacher_id}_{course_id}_"
                            f"s{slot_index}"
                        )
                        model.add_max_equality(active, course_variables)
                        occupied.append(active)
                    model.add_at_most_one(occupied)
            for rule in enabled_rules:
                teacher_ids = set(rule.get("teacherIds") or [])
                if rule["type"] != "教师不同时上" or not teacher_ids:
                    continue
                for slot_index, (day_id, period_id) in enumerate(slots):
                    grouped = [
                        variables[task_index, slot_index]
                        for task_index, task in enumerate(tasks)
                        if task[2] in teacher_ids
                    ]
                    if len(grouped) < 2:
                        continue
                    violation = model.new_bool_var(
                        f"teacher_group_{rule['id']}_s{slot_index}"
                    )
                    model.add(
                        sum(grouped)
                        <= 1 + (len(grouped) - 1) * violation
                    )
                    hard_violations.append(
                        (
                            violation,
                            f"教师不同时上条件在周{day_id}第"
                            f"{period_id}节未能满足",
                        )
                    )
            for rule in enabled_rules:
                teacher_ids = set(rule.get("teacherIds") or [])
                cells = {
                    (cell["dayId"], cell["periodId"])
                    for cell in (rule.get("cells") or [])
                }
                if (
                    rule["type"] != "节次互斥"
                    or not teacher_ids
                    or not cells
                ):
                    continue
                region_slot_indexes = [
                    slot_index
                    for slot_index, slot in enumerate(slots)
                    if slot in cells
                ]
                for teacher_id in teacher_ids:
                    grouped = [
                        variables[task_index, slot_index]
                        for task_index, task in enumerate(tasks)
                        if task[2] == teacher_id
                        for slot_index in region_slot_indexes
                    ]
                    if len(grouped) < 2:
                        continue
                    violation = model.new_bool_var(
                        f"teacher_region_{rule['id']}_{teacher_id}"
                    )
                    model.add(
                        sum(grouped)
                        <= 1 + (len(grouped) - 1) * violation
                    )
                    hard_violations.append(
                        (
                            violation,
                            f"{teacher_id} 的节次互斥条件未能满足",
                        )
                    )
            for rule in enabled_rules:
                teacher_ids = set(rule.get("teacherIds") or [])
                period_a = rule.get("periodA")
                period_b = rule.get("periodB")
                if (
                    rule["type"] != "教师不连上"
                    or not teacher_ids
                    or period_a is None
                    or period_b is None
                    or period_a == period_b
                ):
                    continue
                for teacher_id in teacher_ids:
                    teacher_tasks = [
                        task_index
                        for task_index, task in enumerate(tasks)
                        if task[2] == teacher_id
                    ]
                    if not teacher_tasks:
                        continue
                    for day in document["days"]:
                        slot_a = slot_indexes.get((day["id"], period_a))
                        slot_b = slot_indexes.get((day["id"], period_b))
                        if slot_a is None or slot_b is None:
                            continue
                        grouped = [
                            variables[task_index, slot_index]
                            for task_index in teacher_tasks
                            for slot_index in (slot_a, slot_b)
                        ]
                        violation = model.new_bool_var(
                            f"teacher_period_pair_{rule['id']}_"
                            f"{teacher_id}_d{day['id']}"
                        )
                        model.add(
                            sum(grouped)
                            <= 1 + (len(grouped) - 1) * violation
                        )
                        hard_violations.append(
                            (
                                violation,
                                f"{teacher_id} 的教师不连上条件在周"
                                f"{day['id']}第{period_a}节和"
                                f"第{period_b}节未能满足",
                            )
                        )
            for rule in enabled_rules:
                rel_from = set(rule.get("relFrom") or [])
                rel_to = set(rule.get("relTo") or [])
                if (
                    rule["type"] != "课程不相邻"
                    or not rel_from
                    or not rel_to
                ):
                    continue
                class_ids = set(
                    rule.get("classIds")
                    or [
                        school_class["id"]
                        for school_class in document["classes"]
                    ]
                )
                for class_id in class_ids:
                    from_tasks = [
                        task_index
                        for task_index, task in enumerate(tasks)
                        if task[0] == class_id and task[1] in rel_from
                    ]
                    to_tasks = [
                        task_index
                        for task_index, task in enumerate(tasks)
                        if task[0] == class_id and task[1] in rel_to
                    ]
                    if not from_tasks or not to_tasks:
                        continue
                    for day in document["days"]:
                        for period_a, period_b in zip(
                            document["periods"], document["periods"][1:]
                        ):
                            slot_a = slot_indexes[
                                day["id"], period_a["id"]
                            ]
                            slot_b = slot_indexes[
                                day["id"], period_b["id"]
                            ]
                            grouped = [
                                variables[task_index, slot_a]
                                for task_index in from_tasks
                            ] + [
                                variables[task_index, slot_b]
                                for task_index in to_tasks
                            ]
                            violation = model.new_bool_var(
                                f"course_relation_{rule['id']}_"
                                f"{class_id}_d{day['id']}_"
                                f"p{period_a['id']}_{period_b['id']}"
                            )
                            model.add(sum(grouped) <= 1 + violation)
                            hard_violations.append(
                                (
                                    violation,
                                    f"{class_id} 的课程不相邻条件在周"
                                    f"{day['id']}第{period_a['id']}节"
                                    f"到第{period_b['id']}节未能满足",
                                )
                            )
            for rule in enabled_rules:
                course_ids = set(rule.get("courseIds") or [])
                if rule["type"] != "课程不排同天" or not course_ids:
                    continue
                class_ids = set(
                    rule.get("classIds")
                    or [
                        school_class["id"]
                        for school_class in document["classes"]
                    ]
                )
                for class_id in class_ids:
                    for day_id in {slot[0] for slot in slots}:
                        day_slot_indexes = [
                            slot_index
                            for slot_index, slot in enumerate(slots)
                            if slot[0] == day_id
                        ]
                        present = []
                        for task_index, task in enumerate(tasks):
                            if (
                                task[0] != class_id
                                or task[1] not in course_ids
                            ):
                                continue
                            presence = model.new_bool_var(
                                f"course_day_{rule['id']}_t"
                                f"{task_index}_d{day_id}"
                            )
                            day_variables = [
                                variables[task_index, slot_index]
                                for slot_index in day_slot_indexes
                            ]
                            model.add_max_equality(presence, day_variables)
                            present.append(presence)
                        if len(present) < 2:
                            continue
                        violation = model.new_bool_var(
                            f"course_group_{rule['id']}_"
                            f"{class_id}_d{day_id}"
                        )
                        model.add(
                            sum(present)
                            <= 1 + (len(present) - 1) * violation
                        )
                        hard_violations.append(
                            (
                                violation,
                                f"{class_id} 的课程不排同天条件"
                                f"在周{day_id}未能满足",
                            )
                        )
            for rule in enabled_rules:
                course_ids = set(rule.get("courseIds") or [])
                if (
                    rule["type"] != "课程尽量同时上"
                    or not course_ids
                ):
                    continue
                class_ids = set(
                    rule.get("classIds")
                    or [
                        school_class["id"]
                        for school_class in document["classes"]
                    ]
                )
                selected_tasks = [
                    task_index
                    for task_index, task in enumerate(tasks)
                    if task[0] in class_ids and task[1] in course_ids
                ]
                hours_by_class = {
                    class_id: sum(
                        tasks[task_index][3]
                        for task_index in selected_tasks
                        if tasks[task_index][0] == class_id
                    )
                    for class_id in class_ids
                }
                target = (
                    sum(hours_by_class.values())
                    - max(hours_by_class.values(), default=0)
                )
                if not target:
                    continue
                rewards = []
                for slot_index in range(len(slots)):
                    selected_variables = [
                        variables[task_index, slot_index]
                        for task_index in selected_tasks
                    ]
                    if len(selected_variables) < 2:
                        continue
                    active = model.new_bool_var(
                        f"align_active_{rule['id']}_s{slot_index}"
                    )
                    reward = model.new_int_var(
                        0,
                        len(selected_variables) - 1,
                        f"align_{rule['id']}_s{slot_index}",
                    )
                    model.add_max_equality(active, selected_variables)
                    model.add(reward == sum(selected_variables) - active)
                    rewards.append(reward)
                soft_alignments.append(
                    (rewards, target, "课程尽量同时上", 1)
                )
            course_names = {
                course["id"]: course["name"]
                for course in document["courses"]
            }
            all_class_ids = {
                school_class["id"] for school_class in document["classes"]
            }
            for rule in enabled_rules:
                course_ids = set(rule.get("courseIds") or [])
                period_ids = set(rule.get("periodIds") or [])
                if (
                    rule["type"] != "课程优先排"
                    or not course_ids
                    or not period_ids
                ):
                    continue
                class_ids = set(rule.get("classIds") or all_class_ids)
                penalties = [
                    variables[task_index, slot_index]
                    for task_index, task in enumerate(tasks)
                    if task[0] in class_ids and task[1] in course_ids
                    for slot_index, (_day_id, period_id) in enumerate(slots)
                    if period_id not in period_ids
                ]
                if penalties:
                    names = "、".join(
                        course_names.get(course_id, course_id)
                        for course_id in rule.get("courseIds") or []
                    )
                    preferred_courses.append((penalties, names))
            for rule in enabled_rules:
                if rule["type"] not in {"各天限制", "时段限制"}:
                    continue
                limit_type = rule.get("limitType")
                limit_count = rule.get("limitCount")
                subject_mode = rule.get("subjectMode")
                if (
                    limit_type not in {"最多", "最少", "固定"}
                    or limit_count is None
                    or subject_mode not in {"course", "teacher"}
                ):
                    continue
                class_ids = set(rule.get("classIds") or all_class_ids)
                subjects: list[tuple[str, list[int]]] = []
                if subject_mode == "course":
                    course_ids = rule.get("courseIds") or []
                    subjects = [
                        (
                            f"{class_id}「"
                            f"{course_names.get(course_id, course_id)}」",
                            [
                                task_index
                                for task_index, task in enumerate(tasks)
                                if task[0] == class_id
                                and task[1] == course_id
                            ],
                        )
                        for class_id in class_ids
                        for course_id in course_ids
                    ]
                else:
                    teacher_ids = rule.get("teacherIds") or []
                    subjects = [
                        (
                            teacher_id,
                            [
                                task_index
                                for task_index, task in enumerate(tasks)
                                if task[0] in class_ids
                                and task[2] == teacher_id
                            ],
                        )
                        for teacher_id in teacher_ids
                    ]
                if rule["type"] == "各天限制":
                    regions = [
                        (
                            f"周{next((day['short'] for day in document['days'] if day['id'] == day_id), day_id)}",
                            [
                                slot_index
                                for slot_index, slot in enumerate(slots)
                                if slot[0] == day_id
                            ],
                        )
                        for day_id in (rule.get("dayIds") or [])
                    ]
                else:
                    period_ids = set(rule.get("periodIds") or [])
                    regions = [
                        (
                            "在指定节次",
                            [
                                slot_index
                                for slot_index, slot in enumerate(slots)
                                if slot[1] in period_ids
                            ],
                        )
                    ] if period_ids else []
                for subject, subject_tasks in subjects:
                    if not subject_tasks:
                        continue
                    for region, region_slots in regions:
                        grouped = [
                            variables[task_index, slot_index]
                            for task_index in subject_tasks
                            for slot_index in region_slots
                        ]
                        count = model.new_int_var(
                            0,
                            len(grouped),
                            f"limit_count_{rule['id']}_{len(limit_violations)}",
                        )
                        model.add(count == sum(grouped))
                        violation_bound = max(
                            limit_count,
                            abs(len(grouped) - limit_count),
                        )
                        violation = model.new_int_var(
                            0,
                            violation_bound,
                            f"limit_violation_{rule['id']}_"
                            f"{len(limit_violations)}",
                        )
                        if limit_type == "最多":
                            model.add(violation >= count - limit_count)
                        elif limit_type == "最少":
                            model.add(violation >= limit_count - count)
                        else:
                            model.add_abs_equality(
                                violation, count - limit_count
                            )
                        limit_violations.append(
                            (
                                violation,
                                count,
                                rule["type"],
                                subject,
                                region,
                                limit_count,
                            )
                        )
            for rule in enabled_rules:
                if rule["type"] != "教案齐头":
                    continue
                for key, strength in (rule.get("align") or {}).items():
                    if strength not in {"优先满足", "尽量满足"}:
                        continue
                    teacher_id, separator, course_id = key.partition("|")
                    if not separator or not teacher_id or not course_id:
                        continue
                    selected_tasks = [
                        task_index
                        for task_index, task in enumerate(tasks)
                        if task[1] == course_id and task[2] == teacher_id
                    ]
                    if len(selected_tasks) < 2:
                        continue
                    hours = [tasks[index][3] for index in selected_tasks]
                    target = sum(hours) - max(hours)
                    rewards = []
                    for slot_index in range(len(slots)):
                        selected_variables = [
                            variables[task_index, slot_index]
                            for task_index in selected_tasks
                        ]
                        active = model.new_bool_var(
                            f"lesson_align_active_{rule['id']}_"
                            f"{teacher_id}_{course_id}_s{slot_index}"
                        )
                        reward = model.new_int_var(
                            0,
                            len(selected_variables) - 1,
                            f"lesson_align_{rule['id']}_{teacher_id}_"
                            f"{course_id}_s{slot_index}",
                        )
                        model.add_max_equality(active, selected_variables)
                        model.add(
                            reward == sum(selected_variables) - active
                        )
                        rewards.append(reward)
                    soft_alignments.append(
                        (
                            rewards,
                            target,
                            f"教案齐头（{teacher_id}|{course_id}）",
                            2 if strength == "优先满足" else 1,
                        )
                    )
            soft_rewards = [
                weight * reward
                for rewards, _target, _label, weight in soft_alignments
                for reward in rewards
            ]
            soft_penalties = [
                penalty
                for penalties, _names in preferred_courses
                for penalty in penalties
            ]
            soft_bound = (
                sum(
                    weight * target
                    for _rewards, target, _label, weight
                    in soft_alignments
                )
                + len(soft_penalties)
            )
            park_weight = soft_bound + 1
            hard_weight = (
                sum(task[3] for task in tasks) * park_weight
                + soft_bound
                + 1
            )
            model.minimize(
                hard_weight
                * (
                    sum(
                        violation for violation, _text in hard_violations
                    )
                    + sum(
                        violation
                        for violation, *_details in limit_violations
                    )
                )
                + park_weight * sum(park_variables.values())
                + sum(soft_penalties)
                - sum(soft_rewards)
            )
            solver = cp_model.CpSolver()
            job.engine = solver
            solver.parameters.max_time_in_seconds = seconds
            solve_status = solver.solve(model)
            if job.cancel_event.is_set():
                return
            if solve_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                with self._lock:
                    job.status = "infeasible"
                    job.progress = 100
                    job.message = "未找到可行解"
                    job.result = {
                        "placements": [],
                        "park": [],
                        "unmet": infeasible_diagnostics
                        or [
                            {
                                "text": (
                                    "条件组合无法同时满足，建议逐条停用条件"
                                    "后重试"
                                )
                            }
                        ],
                    }
                return
            placements = fixed_placements + [
                {
                    "id": f"p-{uuid4().hex[:8]}",
                    "classId": class_id,
                    "courseId": course_id,
                    "teacherId": teacher_id,
                    "dayId": slots[slot_index][0],
                    "periodId": slots[slot_index][1],
                    "source": "auto",
                    "locked": False,
                }
                for task_index, (
                    class_id,
                    course_id,
                    teacher_id,
                    _hours,
                ) in enumerate(tasks)
                for slot_index in range(len(slots))
                if (task_index, slot_index) not in fixed_variables
                if solver.value(variables[task_index, slot_index])
            ]
            park = [
                {
                    "id": f"pk-{uuid4().hex[:8]}",
                    "classId": class_id,
                    "courseId": course_id,
                    "teacherId": teacher_id,
                    "source": "auto",
                }
                for task_index, (
                    class_id,
                    course_id,
                    teacher_id,
                    _hours,
                ) in enumerate(tasks)
                for _ in range(solver.value(park_variables[task_index]))
            ]
            unmet = rule_unmet + [
                {"text": text}
                for violation, text in hard_violations
                if solver.value(violation)
            ] + [
                {
                    "text": (
                        f"{rule_type}：{subject}{region}"
                        f"{'仅 ' if actual < limit_count else ''}"
                        f"{actual} 节，"
                        f"{'超过最多' if actual > limit_count else '少于最少' if actual < limit_count else '不等于固定'} "
                        f"{limit_count} 节"
                    )
                }
                for (
                    violation,
                    count,
                    rule_type,
                    subject,
                    region,
                    limit_count,
                ) in limit_violations
                if solver.value(violation)
                for actual in [solver.value(count)]
            ] + [
                {
                    "text": (
                        f"{label}条件仅满足 "
                        f"{sum(solver.value(reward) for reward in rewards)}"
                        f"/{target} 个课位配对"
                    ),
                    "soft": True,
                }
                for rewards, target, label, _weight in soft_alignments
                if sum(solver.value(reward) for reward in rewards) < target
            ] + [
                {
                    "text": (
                        f"「{names}」有 "
                        f"{sum(solver.value(penalty) for penalty in penalties)}"
                        " 节未落在优先节次"
                    ),
                    "soft": True,
                }
                for penalties, names in preferred_courses
                if sum(solver.value(penalty) for penalty in penalties)
            ] + [
                {
                    "text": (
                        f"{class_id} 的 {course_id} 有 "
                        f"{solver.value(park_variables[task_index])} 课时未排"
                    )
                }
                for task_index, (
                    class_id,
                    course_id,
                    _teacher_id,
                    _hours,
                ) in enumerate(tasks)
                if solver.value(park_variables[task_index])
            ]
            with self._lock:
                if job.cancel_event.is_set():
                    return
                job.status = "done"
                job.progress = 100
                job.message = "排课完成"
                job.result = {
                    "placements": placements,
                    "park": park,
                    "unmet": unmet,
                }
        except Exception as error:
            with self._lock:
                if not job.cancel_event.is_set():
                    job.status = "error"
                    job.progress = 100
                    job.message = str(error)
        finally:
            job.engine = None
