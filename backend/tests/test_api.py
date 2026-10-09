import os
import tempfile
import unittest
from fastapi.testclient import TestClient
import main


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        main.DB = os.path.join(self.tmp.name, "test.sqlite3")
        self.client = TestClient(main.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.tmp.cleanup()

    def create(self, questions):
        response = self.client.post(
            "/api/forms", json={"title": "Test", "questions": questions}
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_seed_persistence(self):
        forms = self.client.get("/api/forms").json()
        self.assertEqual(len(forms), 3)
        self.assertEqual(sum(f["response_count"] for f in forms), 10)
        main.initialize()
        self.assertEqual(len(self.client.get("/api/forms").json()), 3)

    def test_publication_and_history(self):
        f = self.create([{"id": "name", "title": "Name", "required": True}])
        fid = f["id"]
        path = f"/api/forms/{fid}"
        public = f"/api/public/{fid}"
        self.assertEqual(self.client.get(public).status_code, 404)
        self.client.post(path + "/publish")
        f["questions"][0]["title"] = "Edited"
        self.client.put(path, json=f)
        self.assertEqual(
            self.client.get(public).json()["questions"][0]["title"], "Name"
        )
        self.assertEqual(
            self.client.post(
                public + "/responses", json={"answers": {"name": "Alex"}, "version": 1}
            ).status_code,
            201,
        )
        self.client.post(path + "/publish")
        self.assertEqual(
            self.client.post(
                public + "/responses", json={"answers": {"name": "Alex"}, "version": 1}
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.get(path + "/responses").json()[0]["snapshot"]["questions"][0][
                "title"
            ],
            "Name",
        )
        self.client.post(path + "/unpublish")
        self.assertEqual(self.client.get(public).status_code, 404)

    def test_all_validation(self):
        kinds = (
            "short_text",
            "long_text",
            "email",
            "number",
            "multiple_choice",
            "dropdown",
            "yes_no",
            "rating",
        )
        f = self.create(
            [
                {
                    "id": k,
                    "type": k,
                    "title": k,
                    "required": True,
                    "options": (
                        ["A", "B"] if k in ("multiple_choice", "dropdown") else []
                    ),
                }
                for k in kinds
            ]
        )
        fid = f["id"]
        self.client.post(f"/api/forms/{fid}/publish")
        url = f"/api/public/{fid}/responses"
        values = dict(
            zip(
                kinds,
                ["Alex", "Feedback", "alex@example.com", "42", "A", "B", "Yes", 5],
            )
        )
        for key, bad in zip(kinds, [" ", 123, "bad", "nan", "C", "C", "Maybe", True]):
            self.assertEqual(
                self.client.post(
                    url, json={"answers": {**values, key: bad}, "version": 1}
                ).status_code,
                422,
                key,
            )
        self.assertEqual(
            self.client.post(
                url, json={"answers": {**values, "unknown": "x"}, "version": 1}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(url, json={"answers": values, "version": 1}).status_code,
            201,
        )
        self.assertEqual(len(self.client.get(f"/api/forms/{fid}/responses").json()), 1)

    def test_reorder_duplicate_cascade_csv(self):
        f = self.create([{"id": "a", "title": "A"}, {"id": "b", "title": "B"}])
        fid = f["id"]
        path = f"/api/forms/{fid}"
        f["questions"].reverse()
        self.client.put(path, json=f)
        self.assertEqual(self.client.get(path).json()["questions"][0]["id"], "b")
        self.client.post(path + "/publish")
        self.client.post(
            f"/api/public/{fid}/responses",
            json={"answers": {"a": '=HYPERLINK("bad")'}, "version": 1},
        )
        self.assertIn("'=HYPERLINK", self.client.get(path + "/export").text)
        duplicate = self.client.post(path + "/duplicate").json()
        self.assertEqual(duplicate["status"], "draft")
        self.assertEqual(duplicate["response_count"], 0)
        self.assertEqual(self.client.delete(path).status_code, 204)
        with main.db() as c:
            self.assertEqual(
                c.execute(
                    "SELECT COUNT(*) FROM responses WHERE form_id=?", (fid,)
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                c.execute("SELECT COUNT(*) FROM answers").fetchone()[0], 50
            )

    def test_invalid_definitions(self):
        for questions in (
            [{"id": "a", "title": "A"}, {"id": "a", "title": "B"}],
            [{"title": "A", "type": "dropdown", "options": ["same", "same"]}],
        ):
            self.assertEqual(
                self.client.post(
                    "/api/forms", json={"title": "Bad", "questions": questions}
                ).status_code,
                422,
            )
        f = self.create([])
        self.assertEqual(
            self.client.post(f"/api/forms/{f['id']}/publish").status_code, 422
        )

    def test_deleted_forms_do_not_reseed(self):
        for form in self.client.get("/api/forms").json():
            self.client.delete(f"/api/forms/{form['id']}")
        main.initialize()
        self.assertEqual(self.client.get("/api/forms").json(), [])
        self.assertEqual(self.client.get("/api/health").status_code, 200)

    def test_trimmed_titles_choices_and_long_duplicate(self):
        for payload in (
            {"title": "   ", "questions": []},
            {"title": "Test", "questions": [{"title": "  "}]},
            {"title": "Test", "questions": [{"title": "Pick", "type": "dropdown", "options": ["A", " A "]}]},
        ):
            self.assertEqual(self.client.post("/api/forms", json=payload).status_code, 422)
        f = self.client.post("/api/forms", json={"title": "A" * 200, "questions": []}).json()
        duplicate = self.client.post(f"/api/forms/{f['id']}/duplicate")
        self.assertEqual(duplicate.status_code, 201)
        self.assertLessEqual(len(duplicate.json()["title"]), 200)

    def test_csv_headers_are_safe_and_public_metadata_is_correct(self):
        f = self.create([{"id": "a", "title": '=HYPERLINK("bad")'}])
        path = f"/api/forms/{f['id']}"
        self.client.post(path + "/publish")
        public = self.client.get(f"/api/public/{f['id']}").json()
        self.assertEqual(public["status"], "published")
        self.client.post(f"/api/public/{f['id']}/responses", json={"answers": {"a": "  =1+1"}, "version": 1})
        import csv, io
        rows = list(csv.reader(io.StringIO(self.client.get(path + "/export").text)))
        self.assertTrue(rows[0][1].startswith("'="))
        self.assertEqual(rows[1][1], "'  =1+1")
        for bad in (True, "1", 0):
            self.assertEqual(self.client.post(f"/api/public/{f['id']}/responses", json={"answers": {}, "version": bad}).status_code, 422)

    def test_consistent_backup_and_invalid_targets(self):
        from backup_db import backup_database
        import sqlite3
        from contextlib import closing
        destination = os.path.join(self.tmp.name, "backups", "copy.sqlite3")
        backup_database(main.DB, destination)
        with closing(sqlite3.connect(destination)) as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM forms").fetchone()[0], 3)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM responses").fetchone()[0], 10)
        with self.assertRaises(ValueError):
            backup_database(main.DB, main.DB)
        with self.assertRaises(FileNotFoundError):
            backup_database(os.path.join(self.tmp.name, "missing.sqlite3"), destination)
