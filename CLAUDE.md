# CLAUDE.md - School Timetable Scheduler

## Project Overview

An **automated school timetable scheduling application** that receives input data (classes, teachers, subjects, constraints) and **autonomously generates optimal timetable solutions** using constraint satisfaction and optimization algorithms.

**CRITICAL DESIGN PRINCIPLE:** The application MUST solve the scheduling problem AUTOMATICALLY. The user only inputs data — the system does ALL the solving. No manual placement of lessons. The engine should produce multiple ranked solutions and allow "what-if" scenario analysis.

---

## Tech Stack

### Backend (Python + FastAPI)
- **Framework:** FastAPI (async, fast, auto-docs)
- **Solver Engine:** Google OR-Tools CP-SAT solver (primary)
- **Database:** PostgreSQL (production) / SQLite (development)
- **ORM:** SQLAlchemy with Alembic migrations
- **Task Queue:** Celery + Redis (for long-running solve operations)
- **API Docs:** Auto-generated via FastAPI OpenAPI

### Frontend (React + TypeScript)
- **Framework:** React 18+ with TypeScript
- **UI Library:** shadcn/ui + Tailwind CSS
- **State Management:** Zustand or React Query
- **Timetable Display:** Custom grid component (NOT a third-party calendar)
- **Drag & Drop:** For manual post-solve adjustments only (dnd-kit)

---

## Project Structure

```
school-scheduler/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app entry
│   │   ├── config.py               # Settings & environment
│   │   ├── models/                 # SQLAlchemy models
│   │   │   ├── __init__.py
│   │   │   ├── school.py           # School, AcademicYear
│   │   │   ├── class_group.py      # Class, Grade, Stream/Track
│   │   │   ├── teacher.py          # Teacher
│   │   │   ├── subject.py          # Subject, SubjectRequirement
│   │   │   ├── constraint.py       # *** UNIFIED CONSTRAINT MODEL ***
│   │   │   ├── room.py             # Room (optional)
│   │   │   ├── timeslot.py         # Day, Period, TimeSlot
│   │   │   └── timetable.py        # Solution, ScheduledLesson
│   │   ├── schemas/                # Pydantic request/response schemas
│   │   ├── api/                    # API route handlers
│   │   │   ├── classes.py
│   │   │   ├── teachers.py
│   │   │   ├── subjects.py
│   │   │   ├── constraints.py      # Unified constraint CRUD
│   │   │   ├── solver.py           # Trigger solve, get results
│   │   │   └── scenarios.py        # What-if analysis
│   │   ├── solver/                 # *** THE CORE ENGINE ***
│   │   │   ├── __init__.py
│   │   │   ├── engine.py           # Main solver orchestrator
│   │   │   ├── model_builder.py    # Builds OR-Tools CP-SAT model
│   │   │   ├── constraint_compiler.py  # Translates DB constraints → OR-Tools constraints
│   │   │   ├── solution_parser.py  # Converts solver output to timetable
│   │   │   ├── scorer.py           # Scores & ranks solutions
│   │   │   ├── validator.py        # Pre-solve data validation & conflict detection
│   │   │   ├── scenario_engine.py  # What-if / relaxation analysis
│   │   │   └── conflict_detector.py # Detects impossible constraint combinations
│   │   ├── services/               # Business logic layer
│   │   └── utils/
│   ├── tests/
│   │   ├── test_constraints/       # Unit tests per constraint rule_type
│   │   ├── test_solver/            # Integration tests for solver
│   │   └── test_api/
│   ├── alembic/                    # DB migrations
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── data-entry/         # Forms for teachers, classes, subjects
│   │   │   ├── constraints/        # Constraint builder UI
│   │   │   ├── timetable/          # Timetable grid display
│   │   │   ├── solver/             # Solve controls, progress, results
│   │   │   ├── scenarios/          # What-if scenario UI
│   │   │   └── common/             # Shared UI components
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── stores/
│   │   ├── types/
│   │   └── api/                    # API client functions
│   ├── package.json
│   └── tsconfig.json
├── CLAUDE.md                       # This file
└── docker-compose.yml              # PostgreSQL + Redis + App
```

---

## Data Model

### Core Entities

#### School Configuration
```
School:
  - id, name
  - days_per_week: int (e.g., 5 or 6)
  - periods_per_day: int (e.g., 8)
  - period_duration_minutes: int (e.g., 45)
  - break_slots: list[int] (e.g., periods 3,6 are breaks)
  - week_start_day: enum (SUNDAY for Israeli schools)

TimeSlot:
  - id
  - day: enum (SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY)
  - period: int (1-based)
  - is_available: bool (some slots may be globally blocked)
```

#### Classes (כיתות)
```
Grade:
  - id, name (e.g., "ז", "ח", "ט")
  - level: int (7, 8, 9...)

ClassGroup:
  - id, name (e.g., "ט1", "ט2")
  - grade_id → Grade
  - num_students: int
  - available_slots: list[TimeSlot] (when this class has school)

GroupingCluster:
  - id, name (e.g., "הקבצת מתמטיקה ט")
  - subject_id → Subject
  - source_classes: list[ClassGroup] (original classes being split)
  - tracks: list[Track]

Track:
  - id, name (e.g., "5 יח", "4 יח", "3 יח")
  - cluster_id → GroupingCluster
  - teacher_id → Teacher
  - hours_per_week: int
  NOTE: Tracks within a cluster MUST be scheduled simultaneously
```

#### Teachers (מורים)
```
Teacher:
  - id, name
  - subjects: list[Subject] (qualified to teach)
  - max_hours_per_week: int
  - min_hours_per_week: int (optional)
  - employment_percentage: float (optional, for part-time)
```

#### Subjects (מקצועות)
```
Subject:
  - id, name (e.g., "מתמטיקה", "אנגלית", "ספורט")
  - color: str (for UI display)

SubjectRequirement:
  - id
  - class_group_id → ClassGroup
  - subject_id → Subject
  - teacher_id → Teacher (assigned teacher, or null for auto-assign)
  - hours_per_week: int
  - is_grouped: bool (part of a grouping cluster?)
  - grouping_cluster_id → GroupingCluster (if grouped)
```

---

## Unified Constraint System

### *** THIS IS THE CORE ARCHITECTURAL DECISION ***

ALL scheduling rules — whether about teachers, subjects, classes, or global preferences — are stored in ONE unified constraint model. This makes the system flexible, extensible, and allows the user to control everything from one place.

### Constraint Model

```
Constraint:
  - id
  - name: str                    # Human-readable name
  - description: str             # Optional longer explanation
  
  # Classification
  - category: enum               # WHO does this apply to?
      TEACHER
      SUBJECT
      CLASS
      GROUPING
      GLOBAL
  
  - type: enum                   # How strict?
      HARD                       # MUST be satisfied
      SOFT                       # SHOULD be satisfied — optimizer will try
  
  - weight: int (1-100)          # Priority for SOFT only (100 = most important)
  
  # What rule to enforce
  - rule_type: enum              # The specific rule (see Rule Types below)
  - parameters: JSON             # Rule-specific parameters
  
  # What entity this applies to
  - target_type: enum            # TEACHER, SUBJECT, CLASS, GRADE, ALL
  - target_id: int (nullable)    # Specific entity ID, or null for ALL
  
  # Status
  - is_active: bool              # Toggle on/off without deleting
  - created_at: datetime
  - notes: str                   # User notes
```

### Rule Types — Complete Catalog

#### TIME RULES (כללי זמן)

```
BLOCK_TIMESLOT
  Parameters: { day: str, period: int }
  Applies to: TEACHER, CLASS
  Can be: HARD or SOFT

BLOCK_DAY
  Parameters: { day: str }
  Applies to: TEACHER, CLASS
  Can be: HARD or SOFT

BLOCK_TIME_RANGE
  Parameters: { day: str | "ALL", from_period: int, to_period: int }
  Applies to: TEACHER, CLASS
  Can be: HARD or SOFT

PREFER_TIME_RANGE
  Parameters: { day: str | "ALL", from_period: int, to_period: int }
  Applies to: SUBJECT, TEACHER
  Can be: SOFT only

PREFER_TIMESLOT
  Parameters: { day: str, period: int }
  Applies to: TEACHER
  Can be: SOFT only

AVOID_LAST_PERIOD
  Parameters: { }
  Applies to: SUBJECT, TEACHER
  Can be: SOFT only
```

#### DISTRIBUTION RULES (כללי פיזור)

```
MAX_PER_DAY
  Parameters: { max: int }
  Applies to: SUBJECT (per class), TEACHER
  Can be: HARD or SOFT

MIN_DAYS_SPREAD
  Parameters: { min_days: int }
  Applies to: SUBJECT (per class)
  Can be: HARD or SOFT

NO_CONSECUTIVE_DAYS
  Parameters: { }
  Applies to: SUBJECT (per class)
  Can be: SOFT only

REQUIRE_CONSECUTIVE_PERIODS
  Parameters: { consecutive_count: int }
  Applies to: SUBJECT
  Can be: HARD or SOFT

SAME_DAY_GROUPING
  Parameters: { }
  Applies to: SUBJECT (per class)
  Can be: SOFT only

NOT_SAME_DAY_AS
  Parameters: { other_subject_id: int }
  Applies to: SUBJECT (per class)
  Can be: SOFT only
```

#### LOAD RULES (כללי עומס)

```
MAX_TEACHING_HOURS_PER_DAY
  Parameters: { max: int }
  Applies to: TEACHER
  Can be: HARD or SOFT

MIN_TEACHING_HOURS_PER_DAY
  Parameters: { min: int }
  Applies to: TEACHER
  Can be: SOFT only

MAX_TEACHING_DAYS
  Parameters: { max_days: int }
  Applies to: TEACHER
  Can be: HARD or SOFT

MIN_FREE_DAYS
  Parameters: { min_days: int }
  Applies to: TEACHER
  Can be: HARD or SOFT

BALANCED_DAILY_LOAD
  Parameters: { max_difference: int }
  Applies to: TEACHER
  Can be: SOFT only
```

#### GAP RULES (כללי חלונות)

```
NO_GAPS
  Parameters: { }
  Applies to: CLASS, TEACHER
  Can be: SOFT only

MAX_GAPS_PER_DAY
  Parameters: { max: int }
  Applies to: TEACHER, CLASS
  Can be: SOFT only

MAX_GAPS_PER_WEEK
  Parameters: { max: int }
  Applies to: CLASS, TEACHER
  Can be: SOFT only
```

#### GROUPING RULES (כללי הקבצה)

```
SYNC_TRACKS
  Parameters: { cluster_id: int }
  Applies to: GROUPING
  ALWAYS HARD

SYNC_TEACHER_CLASSES
  Parameters: { }
  Applies to: TEACHER
  Can be: SOFT only
```

#### GLOBAL RULES (כללי איכות כלליים)

```
EARLY_FINISH
  Parameters: { }
  Applies to: GLOBAL, CLASS
  Can be: SOFT only

MINIMIZE_TEACHER_DAYS
  Parameters: { }
  Applies to: GLOBAL
  Can be: SOFT only

CLASS_DAY_LENGTH_LIMIT
  Parameters: { max_periods: int, day: str | "ALL" }
  Applies to: CLASS, GRADE
  Can be: HARD or SOFT

TEACHER_FIRST_LAST_PREFERENCE
  Parameters: { prefer: "FIRST" | "LAST" | "NOT_FIRST" | "NOT_LAST" }
  Applies to: TEACHER
  Can be: SOFT only
```

### Constraint Templates (תבניות מוכנות)

```python
TEMPLATES = [
  {
    "name": "מורה - חסימת יום",
    "rule_type": "BLOCK_DAY",
    "category": "TEACHER",
    "default_type": "HARD"
  },
  {
    "name": "מקצוע - העדפת בוקר",
    "rule_type": "PREFER_TIME_RANGE",
    "category": "SUBJECT",
    "default_type": "SOFT",
    "default_weight": 70,
    "default_params": { "day": "ALL", "from_period": 1, "to_period": 4 }
  },
  {
    "name": "מקצוע - מקסימום ליום",
    "rule_type": "MAX_PER_DAY",
    "category": "SUBJECT",
    "default_type": "SOFT",
    "default_weight": 70,
    "default_params": { "max": 1 }
  },
  {
    "name": "כיתה - ללא חלונות",
    "rule_type": "NO_GAPS",
    "category": "CLASS",
    "default_type": "SOFT",
    "default_weight": 85
  },
  {
    "name": "מורה - צמצום חלונות",
    "rule_type": "MAX_GAPS_PER_DAY",
    "category": "TEACHER",
    "default_type": "SOFT",
    "default_weight": 60,
    "default_params": { "max": 1 }
  },
  {
    "name": "שעה כפולה",
    "rule_type": "REQUIRE_CONSECUTIVE_PERIODS",
    "category": "SUBJECT",
    "default_type": "HARD",
    "default_params": { "consecutive_count": 2 }
  },
  {
    "name": "יום קצר שישי",
    "rule_type": "CLASS_DAY_LENGTH_LIMIT",
    "category": "GLOBAL",
    "default_type": "HARD",
    "default_params": { "max_periods": 5, "day": "FRIDAY" }
  }
]
```

---

## Solver Engine — THE HEART OF THE APP

### How OR-Tools CP-SAT Works

OR-Tools CP-SAT is Google's solver for combinatorial optimization:
1. Define **variables** (decisions to make)
2. Define **constraints** (rules limiting valid combinations)
3. Define **objective** (what to maximize/minimize)
4. Solver explores solution space using SAT + constraint propagation + parallel search

### Decision Variables

```
x[c, s, t, ts] ∈ {0, 1}
  c  = class_group or track
  s  = subject
  t  = teacher
  ts = timeslot (day, period)
  
  1 = lesson scheduled here, 0 = not
```

### Two Types of Constraints — CRITICAL DISTINCTION

#### SYSTEM CONSTRAINTS (אילוצי מערכת)
Hardcoded in the solver code. The user NEVER sees, configures, or toggles these.
They represent basic physical/logical reality:

```
1. TEACHER_NO_OVERLAP
   A teacher can teach at most 1 lesson per timeslot.
   (A person cannot be in two places at once)
   ∀ teacher t, timeslot ts: Σ x[c,s,t,ts] ≤ 1

2. CLASS_NO_OVERLAP
   A class can have at most 1 lesson per timeslot.
   (Students can't learn two subjects simultaneously)
   ∀ class c, timeslot ts: Σ x[c,s,t,ts] ≤ 1

3. HOURS_EXACT_FULFILLMENT
   Each subject-class pair gets exactly its required weekly hours.
   (If ט1 needs 5 math hours, it gets exactly 5 — not 4, not 6)
   ∀ requirement(c,s): Σ x[c,s,t,ts] = required_hours

4. TEACHER_QUALIFICATION
   A teacher only teaches subjects they are qualified for.
   (History teacher doesn't teach physics)
   ∀ (t,s) where t not qualified: x[c,s,t,ts] = 0

5. CLASS_AVAILABILITY
   No lessons when the class doesn't have school.
   (If ז classes finish at period 6, no lessons at periods 7-8)
   ∀ unavailable(c, ts): x[c,s,t,ts] = 0

6. GROUPING_SYNC
   All tracks in a grouping cluster are scheduled at the same timeslots.
   (If הקבצת מתמטיקה ט has 3 tracks, all 3 happen simultaneously)
   ∀ cluster, ∀ ts: track1[ts] = track2[ts] = track3[ts]

7. SINGLE_TEACHER_PER_ASSIGNMENT
   Each subject-class pair is taught by its assigned teacher only.
   (If שרה teaches math to ט1, no other teacher teaches math to ט1)
```

These are ALWAYS enforced. They are not stored in the constraints table.
They are added in model_builder.py BEFORE any user constraints.

#### USER CONSTRAINTS (אילוצי משתמש)
Stored in the database Constraint table. The user creates, configures,
weights, and toggles these. This is the Unified Constraint System described above.
These are loaded from the database and compiled via constraint_compiler.py.

### Solver Pipeline

```
Step 1: VALIDATE
  ├── Check all required data exists
  ├── Check total hours fit in available timeslots
  ├── Check teacher availability vs assigned hours
  ├── Detect impossible constraint combinations
  └── Return validation report

Step 2: BUILD MODEL
  ├── Create decision variables
  ├── Add SYSTEM CONSTRAINTS (hardcoded, always present):
  │     ├── Teacher no overlap
  │     ├── Class no overlap
  │     ├── Hours exact fulfillment
  │     ├── Teacher qualification
  │     ├── Class availability
  │     ├── Grouping sync
  │     └── Single teacher per assignment
  ├── Load USER CONSTRAINTS from database (only active ones):
  │     ├── For each HARD user constraint:
  │     │     └── constraint_compiler → OR-Tools hard constraint
  │     ├── For each SOFT user constraint:
  │     │     └── Create penalty variable + add to objective × weight
  └── Set objective: MAXIMIZE weighted soft satisfaction

Step 3: SOLVE
  ├── Configure: timeout, workers, solution limit
  ├── Run CP-SAT solver
  ├── Collect multiple solutions via callback
  └── Handle: OPTIMAL / FEASIBLE / INFEASIBLE / TIMEOUT

Step 4: PARSE & SCORE
  ├── Convert variables → ScheduledLesson records
  ├── Score breakdown per constraint
  ├── Rank solutions
  └── Save to database

Step 5: REPORT
  ├── Overall score (0-100)
  ├── Per-constraint satisfaction
  ├── Violated soft constraints with details
  └── Improvement suggestions
```

### Constraint Compiler

Bridge between database constraints and OR-Tools:

```python
def compile_constraint(constraint, model, variables):
    if constraint.rule_type == "BLOCK_TIMESLOT":
        ts = get_timeslot(constraint.parameters)
        if constraint.type == HARD:
            for var in get_vars_for_target(constraint, ts):
                model.Add(var == 0)
        else:  # SOFT
            penalty = model.NewBoolVar(f"penalty_{constraint.id}")
            # penalize if any lesson placed here
            objective_terms.append((penalty, -constraint.weight))
    
    elif constraint.rule_type == "MAX_PER_DAY":
        max_val = constraint.parameters["max"]
        for class_group in relevant_classes:
            for day in days:
                day_vars = get_vars_for(class_group, subject, day)
                if constraint.type == HARD:
                    model.Add(sum(day_vars) <= max_val)
                else:
                    excess = model.NewIntVar(...)
                    model.Add(sum(day_vars) - max_val <= excess)
                    objective_terms.append((excess, -constraint.weight))
    
    # ... pattern continues for each rule_type
```

### Multi-Solution Generation

```python
class SolutionCollector(cp_model.CpSolverSolutionCallback):
    def on_solution_callback(self):
        current = extract_solution(self, variables)
        if is_sufficiently_different(current, self.solutions):
            self.solutions.append(current)
        if len(self.solutions) >= self.max_solutions:
            self.StopSearch()

solver.parameters.max_time_in_seconds = 120
solver.parameters.num_workers = 8
```

### What-If Scenario Engine

```
Scenario Types:
1. TOGGLE_CONSTRAINT    — activate/deactivate constraint, re-solve
2. CHANGE_WEIGHT        — modify soft weight, re-solve
3. CHANGE_TYPE          — switch HARD ↔ SOFT, re-solve
4. TEACHER_UNAVAILABLE  — add temp hard block, re-solve
5. MODIFY_REQUIREMENT   — change hours, re-solve
6. FULL_COMPARISON      — side-by-side any two solutions
```

---

## Solutions Model

```
Solution:
  - id, created_at
  - solve_time_seconds: float
  - total_score: float (0-100 normalized)
  - score_breakdown: JSON {
      satisfied_hard: int,
      total_hard: int,
      soft_scores: [
        { constraint_id, name, weight, satisfaction (0-1),
          weighted_score, violations: [...] }
      ],
      total_soft_score, max_possible, percentage
    }
  - status: OPTIMAL | FEASIBLE | INFEASIBLE | TIMEOUT
  - scenario_name: str (optional)
  - is_baseline: bool

ScheduledLesson:
  - id, solution_id
  - class_group_id / track_id
  - subject_id, teacher_id
  - day, period
  - room_id (optional)
```

---

## API Endpoints

```
# Data Entry CRUD
POST/GET/PUT/DELETE  /api/grades
POST/GET/PUT/DELETE  /api/classes
POST/GET/PUT/DELETE  /api/teachers
POST/GET/PUT/DELETE  /api/subjects
POST/GET/PUT/DELETE  /api/subject-requirements
POST/GET/PUT/DELETE  /api/grouping-clusters

# Unified Constraints
GET    /api/constraints
POST   /api/constraints
PUT    /api/constraints/{id}
DELETE /api/constraints/{id}
PATCH  /api/constraints/{id}/toggle
PATCH  /api/constraints/{id}/weight
GET    /api/constraints/templates
POST   /api/constraints/from-template/{template}
GET    /api/constraints/validate

# Solver
POST   /api/solve
GET    /api/solve/{job_id}/status
GET    /api/solutions
GET    /api/solutions/{id}
DELETE /api/solutions/{id}

# Views
GET    /api/solutions/{id}/by-class/{class_id}
GET    /api/solutions/{id}/by-teacher/{teacher_id}
GET    /api/solutions/{id}/master
GET    /api/solutions/{id}/score-breakdown
GET    /api/solutions/{id}/violations

# Scenarios
POST   /api/scenarios
POST   /api/scenarios/{id}/solve
GET    /api/scenarios/{id}/compare/{baseline_id}

# Validation & Export
POST   /api/validate
GET    /api/solutions/{id}/export/excel
GET    /api/solutions/{id}/export/pdf
```

---

## Frontend Pages

### 1. Dashboard — Data status, latest solution, quick actions
### 2. Data Entry — Classes, Teachers, Subjects, Groupings, Import
### 3. Constraint Builder — Templates, custom builder, visual grid, conflict detection
### 4. Solver Control — Validation, weight sliders, solve button, progress
### 5. Results — Solution ranking, timetable views, score charts, violation list
### 6. Scenarios — What-if creation, comparison, impact analysis

---

## Build Order — 16 Steps in 4 Phases

### Phase 1: Backend Foundation
1. Project setup (FastAPI + SQLAlchemy + SQLite)
2. Core data models + CRUD API
3. Unified constraint system + templates + validation

### Phase 2: Solver Engine
4. Basic solver with HARD constraints only (test with small data)
5. Add SOFT constraints one by one with tests
6. Multi-solution generation + scoring
7. Pre-solve validation + conflict detection

### Phase 3: Frontend
8. React project setup (Vite + TS + Tailwind + RTL)
9. Data entry pages
10. Constraint builder UI
11. Solver page with progress
12. Timetable display + score visualization

### Phase 4: Advanced
13. Scenario engine + comparison UI
14. Excel/PDF export
15. CSV/Excel import
16. Polish, performance, error handling

---

## Key Design Decisions

- Hebrew UI, RTL layout
- Israeli school week (Sunday–Friday, configurable)
- Unified constraint model — ONE table for ALL rules
- Async solving via Celery + Redis
- No manual scheduling — auto-solve only, then adjust
- Full transparency — score breakdown per constraint
- Weight-based priority — users control importance via sliders

---

## Coding Standards

- Python: Type hints, docstrings, Black formatter
- TypeScript: Strict mode, no `any`
- API: RESTful, Hebrew error messages
- Tests: Unit per rule_type, integration for solver
- Git: Conventional commits, feature branches

---

## Environment Variables

```
DATABASE_URL=postgresql://user:pass@localhost:5432/scheduler
REDIS_URL=redis://localhost:6379
SOLVER_MAX_TIME=120
SOLVER_MAX_SOLUTIONS=5
SOLVER_NUM_WORKERS=8
SECRET_KEY=...
DEBUG=true
```

