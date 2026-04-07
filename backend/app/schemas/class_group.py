from pydantic import BaseModel


class ClassGroupCreate(BaseModel):
    school_id: int
    name: str
    grade_id: int
    homeroom_daily_required: bool = False
    homeroom_config: dict | None = None
    shahaf_id: str | None = None


class ClassGroupUpdate(BaseModel):
    name: str | None = None
    grade_id: int | None = None
    homeroom_daily_required: bool | None = None
    homeroom_config: dict | None = None
    shahaf_id: str | None = None


class ClassGroupRead(BaseModel):
    id: int
    school_id: int
    name: str
    grade_id: int
    homeroom_daily_required: bool = False
    homeroom_config: dict | None = None
    shahaf_id: str | None = None

    model_config = {"from_attributes": True}
