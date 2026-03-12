"""FastAPI dependencies for authentication and authorization."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth import decode_access_token
from app.database import get_db
from app.models.user import User, UserRole

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate the current user from JWT token."""
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="טוקן לא תקין או פג תוקף",
        )
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="משתמש לא נמצא או לא פעיל",
        )
    return user


def require_super_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Only SUPER_ADMIN can access this route."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="הגישה מותרת למנהל ראשי בלבד",
        )
    return current_user


def require_school_access(school_id: int, current_user: User = Depends(get_current_user)) -> User:
    """Ensure user has access to the given school.
    SUPER_ADMIN has access to all schools.
    SCHOOL_ADMIN only to their assigned school.
    """
    if current_user.role == UserRole.SUPER_ADMIN:
        return current_user
    if current_user.school_id != school_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="אין לך הרשאה לגשת לבית ספר זה",
        )
    return current_user
