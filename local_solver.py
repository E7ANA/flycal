#!/usr/bin/env python3
"""
Local Solver — runs the OR-Tools solver on your machine using the remote database.

Usage:
    1. Copy the DATABASE_URL from Render Dashboard → flycal-db → External Connection String
    2. Run:
       DATABASE_URL="postgresql://..." python local_solver.py --school-id 1

    Or create a .env.local file:
       DATABASE_URL=postgresql://user:pass@host:5432/flycal

    Then run:
       python local_solver.py --school-id 1

The solver runs locally on your powerful CPU and writes results directly to the
remote PostgreSQL database. The web app on Render will show the results immediately.
"""

import argparse
import os
import sys
import time

# Load .env.local if it exists
from pathlib import Path
env_local = Path(__file__).parent / ".env.local"
if env_local.exists():
    for line in env_local.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

# Ensure DATABASE_URL is set before importing app modules
if "DATABASE_URL" not in os.environ:
    print("ERROR: DATABASE_URL not set.")
    print("Set it as an environment variable or create .env.local")
    print("Get it from: Render Dashboard → flycal-db → External Connection String")
    sys.exit(1)

# Now import app modules (they use DATABASE_URL from env)
sys.path.insert(0, str(Path(__file__).parent / "backend"))
os.environ.setdefault("DEBUG", "false")

from app.database import SessionLocal
from app.solver.engine import solve, SolutionStatus
from app.solver.validator import validate


def main():
    parser = argparse.ArgumentParser(description="Run the timetable solver locally")
    parser.add_argument("--school-id", type=int, required=True, help="School ID to solve for")
    parser.add_argument("--max-time", type=int, default=300, help="Max solver time in seconds (default: 300)")
    parser.add_argument("--max-solutions", type=int, default=5, help="Max solutions to find (default: 5)")
    parser.add_argument("--workers", type=int, default=8, help="Number of solver workers (default: 8)")
    parser.add_argument("--validate-only", action="store_true", help="Only validate, don't solve")
    args = parser.parse_args()

    db = SessionLocal()

    try:
        # Step 1: Validate
        print(f"\n🔍 Validating data for school {args.school_id}...")
        report = validate(args.school_id, db)

        if report.get("errors"):
            print("\n❌ Validation errors:")
            for err in report["errors"]:
                print(f"  • {err}")
            print("\nFix these in the web app before solving.")
            sys.exit(1)

        if report.get("warnings"):
            print("\n⚠️  Warnings:")
            for warn in report["warnings"]:
                print(f"  • {warn}")

        print("✅ Validation passed!")

        if args.validate_only:
            return

        # Step 2: Solve
        print(f"\n🧮 Starting solver (max {args.max_time}s, {args.workers} workers)...")
        start = time.time()

        result = solve(
            school_id=args.school_id,
            db=db,
            max_time=args.max_time,
            max_solutions=args.max_solutions,
            num_workers=args.workers,
        )

        elapsed = time.time() - start

        # Step 3: Report
        status = result.get("status", "UNKNOWN")
        print(f"\n{'='*50}")
        print(f"Status: {status}")
        print(f"Time:   {elapsed:.1f}s")

        solutions = result.get("solutions", [])
        if solutions:
            print(f"Found:  {len(solutions)} solution(s)")
            for i, sol in enumerate(solutions, 1):
                score = sol.get("total_score", "?")
                print(f"  Solution {i}: score = {score}")
            print(f"\n✅ Results saved to database — view them in the web app!")
        else:
            print("\n❌ No solutions found.")
            if status == "INFEASIBLE":
                print("The constraints are impossible to satisfy together.")
                print("Try relaxing some HARD constraints in the web app.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
