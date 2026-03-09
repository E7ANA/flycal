from pydantic import BaseModel


class ClassGroupCreate(BaseModel):
    school_id: int
    name: str
    grade_id: int
    num_students: int = 0


class ClassGroupUpdate(BaseModel):
    name: str | None = None
    grade_id: int | None = None
    num_students: int | None = None


class ClassGroupRead(BaseModel):
    id: int
    school_id: int
    name: str
    grade_id: int
    num_students: int

    model_config = {"from_attributes": True}
