"""Staff schedules: /schedules*.

Third extraction out of server.py's monolith (see CLAUDE.md, "server.py,
JWT, CI"). Imports `db`/`get_current_user` from core.py rather than from
server.py, the same pattern the other extracted routers already use.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import staff
from core import db, get_current_user
from gating import check
from org_scope import can_delete, scope, stamp
from organisations import get_org_context

router = APIRouter(prefix="/api")


class ScheduleDayInput(BaseModel):
    off: bool = False
    start: str = ""
    end: str = ""


class ScheduleEmployeeInput(BaseModel):
    employee_id: Optional[str] = None
    name: str = ""
    days: List[Optional[ScheduleDayInput]] = Field(default_factory=list)
    overtime_minutes: int = 0


class ScheduleInput(BaseModel):
    week_start: str  # YYYY-MM-DD, the Sunday that opens the week
    notes: str = ""
    employees: List[ScheduleEmployeeInput] = Field(default_factory=list)


def _validate_week_start(value: str) -> str:
    """The week always opens on a Sunday, matching the printed grid."""
    try:
        d = datetime.strptime(value, "%Y-%m-%d")
    except (ValueError, TypeError):
        raise HTTPException(422, "Date invalide (format attendu : AAAA-MM-JJ)")
    # Monday is 0 in Python; Sunday is 6.
    if d.weekday() != 6:
        raise HTTPException(422, "La semaine doit commencer un dimanche")
    return value

def _build_schedule_employees(inp: ScheduleInput) -> list:
    if len(inp.employees) > staff.MAX_EMPLOYEES:
        raise HTTPException(422, f"{staff.MAX_EMPLOYEES} personnes au maximum")

    employees = []
    for item in inp.employees:
        name = (item.name or "").strip()
        if not name:
            raise HTTPException(422, "Chaque personne doit avoir un nom")
        if item.overtime_minutes < 0:
            raise HTTPException(422, "Les heures supplémentaires ne peuvent pas être négatives")

        days = [(d.model_dump() if d else None) for d in item.days][:staff.DAYS]
        days += [None] * (staff.DAYS - len(days))
        for day in days:
            # Refuse unreadable times here rather than storing a cell that would
            # silently count as zero hours in every total downstream.
            if day and not day.get("off") and (day.get("start") or day.get("end")):
                if staff.shift_minutes(day.get("start", ""), day.get("end", "")) is None:
                    raise HTTPException(422, f"Horaire invalide pour {name} (format attendu : 8:00)")

        employees.append({
            "employee_id": item.employee_id or str(uuid.uuid4()),
            "name": name,
            "days": days,
            "overtime_minutes": int(item.overtime_minutes),
        })
    return employees

def _schedule_detail(doc: dict) -> dict:
    doc.pop("_id", None)
    return {**doc, **staff.summarize(doc.get("employees"))}

def _schedule_summary(doc: dict) -> dict:
    computed = staff.summarize(doc.get("employees"))
    return {
        "id": doc["id"],
        "week_start": doc.get("week_start"),
        "notes": doc.get("notes", ""),
        "employee_count": len(doc.get("employees") or []),
        "grand_total_minutes": computed["grand_total_minutes"],
        "updated_at": doc.get("updated_at"),
    }

@router.get("/schedules")
async def list_schedules(user: dict = Depends(get_current_user), org: dict = Depends(get_org_context)):
    docs = await db.schedules.find({**scope(user, org)}, {"_id": 0}).sort("week_start", -1).to_list(200)
    return [_schedule_summary(d) for d in docs]

@router.post("/schedules")
async def create_schedule(
    inp: ScheduleInput, user: dict = Depends(get_current_user), org: dict = Depends(get_org_context),
):
    week_start = _validate_week_start(inp.week_start)
    employees = _build_schedule_employees(inp)
    # `check` plutôt que la dépendance `require` : le plafond porte sur
    # l'effectif de la grille envoyée, donc la quantité consommée n'est
    # connue qu'une fois la charge utile validée. `schedules_total` (une
    # grille de plus, stock — supprimer une grille libère une place) ne se
    # vérifie qu'à la création, jamais à la modification d'une grille déjà
    # possédée (voir update_schedule ci-dessous, qui ne revérifie que
    # schedule_employees).
    await check(user, feature="staff_schedule",
                quotas=[("schedules_total", 1), ("schedule_employees", len(employees))],
                org=org)
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        **stamp(user, org),
        "week_start": week_start,
        "notes": (inp.notes or "").strip(),
        "employees": employees,
        "created_at": now,
        "updated_at": now,
    }
    await db.schedules.insert_one(doc)
    return _schedule_detail(doc)

@router.get("/schedules/{schedule_id}")
async def get_schedule(
    schedule_id: str, user: dict = Depends(get_current_user), org: dict = Depends(get_org_context),
):
    doc = await db.schedules.find_one({"id": schedule_id, **scope(user, org)}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Emploi du temps introuvable")
    return _schedule_detail(doc)

@router.put("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: str, inp: ScheduleInput,
    user: dict = Depends(get_current_user), org: dict = Depends(get_org_context),
):
    existing = await db.schedules.find_one({"id": schedule_id, **scope(user, org)}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Emploi du temps introuvable")
    update = {
        "week_start": _validate_week_start(inp.week_start),
        "notes": (inp.notes or "").strip(),
        "employees": _build_schedule_employees(inp),
        "updated_at": datetime.now(timezone.utc),
    }
    await check(user, feature="staff_schedule",
                quota="schedule_employees", amount=len(update["employees"]), org=org)
    await db.schedules.update_one({"id": schedule_id, **scope(user, org)}, {"$set": update})
    return _schedule_detail({**existing, **update})

@router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: str, user: dict = Depends(get_current_user), org: dict = Depends(get_org_context),
):
    doc = await db.schedules.find_one({"id": schedule_id, **scope(user, org)}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Emploi du temps introuvable")
    if not can_delete(user, org, doc):
        raise HTTPException(403, "Seuls l'auteur ou l'encadrement peuvent supprimer cet emploi du temps.")
    await db.schedules.delete_one({"id": schedule_id, **scope(user, org)})
    return {"status": "deleted"}

@router.post("/schedules/{schedule_id}/duplicate")
async def duplicate_schedule(
    schedule_id: str, inp: dict = None,
    user: dict = Depends(get_current_user), org: dict = Depends(get_org_context),
):
    """Copy a week onto another one, keeping names, shifts and days off."""
    source = await db.schedules.find_one({"id": schedule_id, **scope(user, org)}, {"_id": 0})
    if not source:
        raise HTTPException(404, "Emploi du temps introuvable")

    week_start = _validate_week_start((inp or {}).get("week_start") or "")
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        **stamp(user, org),
        "week_start": week_start,
        # The note belongs to its week ("Armand off jeudi"), so it is not copied.
        "notes": "",
        "employees": [
            {**e, "employee_id": str(uuid.uuid4())}
            for e in (source.get("employees") or [])
        ],
        "created_at": now,
        "updated_at": now,
    }
    await db.schedules.insert_one(doc)
    return _schedule_detail(doc)
