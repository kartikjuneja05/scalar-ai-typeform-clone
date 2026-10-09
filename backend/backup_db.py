"""Create a consistent SQLite backup, including committed WAL writes."""
import argparse
import sqlite3
from pathlib import Path


def backup_database(source: str, destination: str) -> Path:
    original = Path(source).resolve()
    target = Path(destination).resolve()
    if original == target:
        raise ValueError("The backup must be a different file from the live database")
    if not original.is_file():
        raise FileNotFoundError(f"Database does not exist: {original}")
    target.parent.mkdir(parents=True, exist_ok=True)
    # Read-only mode prevents a typo in the source path from creating a new database.
    src = sqlite3.connect(original.as_uri() + "?mode=ro", uri=True)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return target


if __name__ == "__main__":
    from main import DB
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", help="Backup SQLite file path")
    args = parser.parse_args()
    print(backup_database(DB, args.destination))
