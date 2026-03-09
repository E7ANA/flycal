from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.classes import router as classes_router
from app.api.constraints import router as constraints_router
from app.api.export import router as export_router
from app.api.imports import router as imports_router
from app.api.meetings import router as meetings_router
from app.api.scenarios import router as scenarios_router
from app.api.solver import router as solver_router
from app.api.grades import router as grades_router
from app.api.groupings import router as groupings_router
from app.api.groupings import track_router as tracks_router
from app.api.schools import router as schools_router
from app.api.subjects import req_router as requirements_router
from app.api.subjects import router as subjects_router
from app.api.teachers import router as teachers_router
from app.api.timeslots import router as timeslots_router
from app.config import settings
from app.database import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup (dev only; production uses Alembic)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(schools_router)
app.include_router(grades_router)
app.include_router(classes_router)
app.include_router(teachers_router)
app.include_router(subjects_router)
app.include_router(requirements_router)
app.include_router(groupings_router)
app.include_router(tracks_router)
app.include_router(timeslots_router)
app.include_router(constraints_router)
app.include_router(solver_router)
app.include_router(scenarios_router)
app.include_router(export_router)
app.include_router(imports_router)
app.include_router(meetings_router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}
