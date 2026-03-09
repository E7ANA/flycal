from pydantic import BaseModel


class GradeCreate(BaseModel):
    school_id: int
    name: str
    level: int


class GradeUpdate(BaseModel):
    name: str | None = None
    level: int | None = None


class GradeRead(BaseModel):
    id: int
    school_id: int
    name: str
    level: int

    model_config = {"from_attributes": True}
