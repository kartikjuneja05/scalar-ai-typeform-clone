import os
import tempfile
import time
import unittest
from fastapi.testclient import TestClient
import main
import auth


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        main.DB = os.path.join(self.tmp.name, "accounts.sqlite3")
        self.client = TestClient(main.app)
        self.client.__enter__()
        self.client.get("/api/auth/session")

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.tmp.cleanup()

    def register(self, client=None, email="alex@example.com", name="Alex"):
        client = client or self.client
        return client.post("/api/auth/register", json={"name": name, "email": email, "password": "correct-horse-42"})

    def form(self):
        return self.client.post("/api/forms", json={"title": "Private form", "questions": [{"id":"name","title":"Name", "required":True}]}).json()

    def test_default_guest_session_and_cookie(self):
        session = self.client.get("/api/auth/session")
        self.assertEqual(session.json(), {"name":"guest", "email":None, "is_guest":True})
        self.assertEqual(session.headers["cache-control"], "no-store")
        other = TestClient(main.app)
        response = other.get("/api/auth/session")
        cookie = response.headers["set-cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=lax", cookie)
        self.assertNotEqual(other.cookies.get(auth.COOKIE), self.client.cookies.get(auth.COOKIE))
        with main.db() as c:
            self.assertIsNone(c.execute("SELECT * FROM sessions WHERE token_hash=?", (self.client.cookies.get(auth.COOKIE),)).fetchone())

    def test_guest_forms_are_private_and_published_fill_is_public(self):
        f = self.form();path=f"/api/forms/{f['id']}"
        self.client.post(path+"/publish")
        other=TestClient(main.app)
        self.assertEqual(other.get("/api/forms").json(), [])
        for suffix in ("", "/responses", "/export"):
            self.assertEqual(other.get(path+suffix).status_code,404)
        self.assertEqual(other.put(path,json=f).status_code,404)
        self.assertEqual(other.delete(path).status_code,404)
        for action in ("duplicate", "publish", "unpublish"):
            self.assertEqual(other.post(path+"/"+action).status_code,404)
        respondent=TestClient(main.app)
        public=respondent.get(f"/api/public/{f['id']}")
        self.assertEqual(public.status_code,200)
        self.assertNotIn("set-cookie",public.headers)
        result=respondent.post(f"/api/public/{f['id']}/responses",json={"answers":{"name":"Anonymous respondent"},"version":1})
        self.assertEqual(result.status_code,201)
        self.assertNotIn("set-cookie",result.headers)
        self.assertEqual(len(self.client.get(path+"/responses").json()),1)

    def test_registration_keeps_guest_forms_and_rotates_session(self):
        f=self.form();before=self.client.cookies.get(auth.COOKIE)
        response=self.register()
        self.assertEqual(response.status_code,201,response.text)
        self.assertEqual(response.json(),{"name":"Alex","email":"alex@example.com","is_guest":False})
        self.assertNotEqual(before,self.client.cookies.get(auth.COOKIE))
        self.assertEqual(self.client.get(f"/api/forms/{f['id']}").status_code,200)
        with main.db() as c:
            row=c.execute("SELECT * FROM creators WHERE email='alex@example.com'").fetchone()
            self.assertNotEqual(row["password_hash"],"correct-horse-42")
            self.assertTrue(row["password_hash"].startswith("pbkdf2_sha256$600000$"))
            self.assertIsNone(c.execute("SELECT * FROM sessions WHERE token_hash=?",(auth.token_digest(before),)).fetchone())

    def test_logout_then_login_restores_account_and_imports_guest_forms(self):
        f=self.form();self.register();token=self.client.cookies.get(auth.COOKIE)
        logout=self.client.post("/api/auth/logout")
        self.assertTrue(logout.json()["is_guest"])
        self.assertEqual(logout.json()["name"],"guest")
        self.assertEqual(self.client.get("/api/forms").json(),[])
        visitor=self.form()
        wrong=self.client.post("/api/auth/login",json={"email":"alex@example.com","password":"wrong-password"})
        self.assertEqual(wrong.status_code,401)
        self.assertTrue(self.client.get("/api/auth/session").json()["is_guest"])
        login=self.client.post("/api/auth/login",json={"email":"ALEX@EXAMPLE.COM","password":"correct-horse-42"})
        self.assertEqual(login.status_code,200,login.text)
        for fid in (f["id"],visitor["id"]):
            self.assertEqual(self.client.get(f"/api/forms/{fid}").status_code,200)
        with main.db() as c:
            self.assertIsNone(c.execute("SELECT * FROM sessions WHERE token_hash=?",(auth.token_digest(token),)).fetchone())

    def test_duplicate_email_and_bad_registration(self):
        self.assertEqual(self.register().status_code,201)
        other=TestClient(main.app)
        self.assertEqual(self.register(other,email="ALEX@example.com").status_code,409)
        for payload in ({"name":" ","email":"valid@example.com","password":"12345678"},{"name":"Alex","email":"invalid","password":"12345678"},{"name":"Alex","email":"valid@example.com","password":"short"}):
            self.assertEqual(other.post("/api/auth/register",json=payload).status_code,422)

    def test_expired_sessions_do_not_expose_account_forms(self):
        f=self.form();self.register();token=self.client.cookies.get(auth.COOKIE)
        with main.db() as c:
            c.execute("UPDATE sessions SET expires_at=? WHERE token_hash=?",(int(time.time())-1,auth.token_digest(token)))
        self.assertTrue(self.client.get("/api/auth/session").json()["is_guest"])
        self.assertEqual(self.client.get(f"/api/forms/{f['id']}").status_code,404)

    def test_sessions_persist_across_restart_and_secure_cookie_setting(self):
        self.register();main.initialize()
        self.assertEqual(self.client.get("/api/auth/session").json()["email"],"alex@example.com")
        from unittest.mock import patch
        with patch.dict(os.environ,{"COOKIE_SECURE":"true"}):
            result=TestClient(main.app).get("/api/auth/session")
        self.assertIn("Secure",result.headers["set-cookie"])

    def test_legacy_database_migration_preserves_forms(self):
        import sqlite3
        from contextlib import closing
        legacy_path=os.path.join(self.tmp.name,"legacy.sqlite3")
        with closing(sqlite3.connect(legacy_path)) as c:
            c.execute("""CREATE TABLE forms(
                id TEXT PRIMARY KEY,title TEXT NOT NULL,theme TEXT NOT NULL,
                thank_you TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',
                version INTEGER NOT NULL DEFAULT 0,published_snapshot TEXT,
                created_at TEXT NOT NULL,updated_at TEXT NOT NULL
            )""")
            c.execute("INSERT INTO forms(id,title,theme,thank_you,created_at,updated_at) VALUES('legacy','Legacy form','paper','Thank you','2026-10-09','2026-10-09')")
            c.commit()
        main.DB=legacy_path
        main.initialize()
        forms=self.client.get("/api/forms").json()
        self.assertEqual(len(forms),1)
        self.assertEqual(forms[0]["id"],"legacy")
        with main.db() as c:
            self.assertIsNotNone(c.execute("SELECT owner_id FROM forms WHERE id='legacy'").fetchone()[0])
