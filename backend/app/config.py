import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    app_name: str = "School Timetable Scheduler"
    debug: bool = True

    # Database
    database_url: str = f"sqlite:///{Path(__file__).resolve().parent.parent / 'scheduler.db'}"

    # Solver
    solver_max_time: int = 300
    solver_max_solutions: int = 5
    solver_num_workers: int = 8

    # AI
    anthropic_api_key: str = ""

    # Auth
    secret_key: str = "change-me-in-production-use-a-real-secret-key"

    # CORS — allow Render domain + localhost
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    @property
    def is_production(self) -> bool:
        return "RENDER" in os.environ


settings = Settings()
