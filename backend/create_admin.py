"""Create the initial SUPER_ADMIN user. Run once on setup."""

import sys
from getpass import getpass

from app.auth import hash_password
from app.database import Base, SessionLocal, engine
from app.models.user import User, UserRole

# Ensure tables exist
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Check if a super admin already exists
existing = db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first()
if existing:
    print(f"SUPER_ADMIN already exists: {existing.email}")
    sys.exit(0)

print("=== Create SUPER_ADMIN ===")
email = input("Email: ").strip()
name = input("Name: ").strip()
password = getpass("Password: ")
confirm = getpass("Confirm password: ")

if password != confirm:
    print("Passwords don't match!")
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
