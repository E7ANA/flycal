from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "SCHOOL_ADMIN"
    school_id: int | None = None


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    name: str | None = None
    role: str | None = None
    school_id: int | None = None
    is_active: bool | None = None


class UserRead(BaseModel):
    id: int
    email: str
    name: str
    role: str
    school_id: int | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead
