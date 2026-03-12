"""Create SUPER_ADMIN from environment variables (for Render one-time setup).

Usage on Render Shell:
  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret ADMIN_NAME=Admin python create_admin_env.py
"""

import os
import sys

from app.auth import hash_password
from app.database import Base, SessionLocal, engine
from app.models.user import User, UserRole

Base.metadata.create_all(bind=engine)
db = SessionLocal()

existing = db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first()
if existing:
    print(f"SUPER_ADMIN already exists: {existing.email}")
    sys.exit(0)

email = os.environ.get("ADMIN_EMAIL")
password = os.environ.get("ADMIN_PASSWORD")
name = os.environ.get("ADMIN_NAME", "Admin")

if not email or not password:
    print("Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables")
    sys.exit(1)

user = User(
    email=email,
    hashed_password=hash_password(password),
    name=name,
    role=UserRole.SUPER_ADMIN,
    school_id=None,
)
db.add(user)
db.commit()
print(f"SUPER_ADMIN created: {email}")
db.close()
