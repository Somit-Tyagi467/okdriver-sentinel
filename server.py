"""OkDriver Sentinel demo API. Standard-library only; suitable for local evaluation."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import queue
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent


def load_local_env() -> None:
    """Load simple KEY=VALUE settings from .env without overriding process settings."""
    env_file = ROOT / ".env"
    if not env_file.is_file():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


load_local_env()
DB_PATH = Path(os.getenv("OKDRIVER_DB", ROOT / "data" / "okdriver.sqlite3"))
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
ADMIN_PASSWORD = os.getenv("OKDRIVER_ADMIN_PASSWORD", "")
OPERATOR_PASSWORD = os.getenv("OKDRIVER_OPERATOR_PASSWORD", "")
DEMO_MODE = os.getenv("OKDRIVER_DEMO_MODE", "true").lower() == "true"
TOKEN_KEY = os.getenv("OKDRIVER_TOKEN_KEY") or secrets.token_hex(32)


def validate_configuration() -> None:
    """Fail early if demo credentials are missing or still template placeholders."""
    for name, value in (("OKDRIVER_ADMIN_PASSWORD", ADMIN_PASSWORD), ("OKDRIVER_OPERATOR_PASSWORD", OPERATOR_PASSWORD)):
        if len(value) < 12 or value.startswith("REPLACE_WITH_"):
            raise RuntimeError(f"Set {name} to a unique password of at least 12 characters in .env")
    if len(TOKEN_KEY) < 32 or TOKEN_KEY.startswith("REPLACE_WITH_"):
        raise RuntimeError("Set OKDRIVER_TOKEN_KEY to a random value of at least 32 characters in .env")
DB_LOCK = threading.RLock()
SUBSCRIBERS: list[tuple[queue.Queue, str, str, str]] = []
CENTERS = [
    ("all", "All Command Centers", "Multi-state", 23.5, 72.0),
    ("ahmedabad", "Ahmedabad", "Gujarat", 23.0225, 72.5714), ("surat", "Surat", "Gujarat", 21.1702, 72.8311),
    ("vadodara", "Vadodara", "Gujarat", 22.3072, 73.1812), ("rajkot", "Rajkot", "Gujarat", 22.3039, 70.8022),
    ("gandhinagar", "Gandhinagar", "Gujarat", 23.2156, 72.6369), ("jaipur", "Jaipur", "Rajasthan", 26.9124, 75.7873),
    ("mumbai", "Mumbai", "Maharashtra", 19.0760, 72.8777), ("bhopal", "Bhopal", "Madhya Pradesh", 23.2599, 77.4126),
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class ClosingConnection(sqlite3.Connection):
    """Commit/rollback as usual, then release the SQLite handle at block exit."""
    def __exit__(self, exc_type, exc, traceback):
        try:
            return super().__exit__(exc_type, exc, traceback)
        finally:
            self.close()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10, factory=ClosingConnection)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def initialize() -> None:
    validate_configuration()
    with DB_LOCK, connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS cameras(
          id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL,
          latitude REAL NOT NULL, longitude REAL NOT NULL, camera_type TEXT NOT NULL,
          protocol TEXT NOT NULL, endpoint_ref TEXT NOT NULL, status TEXT NOT NULL,
          last_heartbeat TEXT NOT NULL, zone TEXT NOT NULL, storage TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, command_center_id TEXT
        );
        CREATE TABLE IF NOT EXISTS watchlist(
          id INTEGER PRIMARY KEY AUTOINCREMENT, identifier TEXT NOT NULL UNIQUE,
          entity_type TEXT NOT NULL, reason TEXT NOT NULL, priority TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS detections(
          id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id TEXT NOT NULL REFERENCES cameras(id),
          timestamp TEXT NOT NULL, vehicle_number TEXT NOT NULL, confidence REAL NOT NULL,
          vehicle_type TEXT NOT NULL, event_type TEXT NOT NULL, bounding_box TEXT,
          source_id TEXT NOT NULL UNIQUE, matched_watchlist_id INTEGER, owner_user TEXT,
          FOREIGN KEY(matched_watchlist_id) REFERENCES watchlist(id)
        );
        CREATE INDEX IF NOT EXISTS idx_detections_entity_time ON detections(vehicle_number, timestamp);
        CREATE INDEX IF NOT EXISTS idx_detections_camera_time ON detections(camera_id, timestamp);
        CREATE TABLE IF NOT EXISTS alerts(
          id INTEGER PRIMARY KEY AUTOINCREMENT, detection_id INTEGER NOT NULL UNIQUE REFERENCES detections(id),
          watchlist_id INTEGER NOT NULL REFERENCES watchlist(id), status TEXT NOT NULL DEFAULT 'Open',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, owner_user TEXT
        );
        CREATE TABLE IF NOT EXISTS audit_log(
          id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
          target TEXT NOT NULL, details TEXT NOT NULL, timestamp TEXT NOT NULL,
          actor_role TEXT NOT NULL DEFAULT 'system', command_center_id TEXT
        );
        CREATE TABLE IF NOT EXISTS command_centers(id TEXT PRIMARY KEY,name TEXT NOT NULL,state TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN ('admin','operator')),password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS user_command_centers(username TEXT NOT NULL REFERENCES users(username),command_center_id TEXT NOT NULL REFERENCES command_centers(id),PRIMARY KEY(username,command_center_id));
        """)
        # Additive migrations preserve databases created by earlier assignment versions.
        def add_column(table, name, declaration):
            cols = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
            if name not in cols: db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")
        add_column("cameras", "command_center_id", "TEXT")
        add_column("detections", "owner_user", "TEXT")
        add_column("alerts", "owner_user", "TEXT")
        add_column("audit_log", "actor_role", "TEXT NOT NULL DEFAULT 'system'")
        add_column("audit_log", "command_center_id", "TEXT")
        db.execute("CREATE INDEX IF NOT EXISTS idx_cameras_command_center ON cameras(command_center_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_detections_owner_time ON detections(owner_user,timestamp)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_owner_time ON alerts(owner_user,created_at)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_log(actor,timestamp)")
        stamp = now()
        db.executemany("INSERT OR IGNORE INTO command_centers VALUES(?,?,?,?,?,1)", [(i,n,s,lat,lon) for i,n,s,lat,lon in CENTERS])
        def provision(username, role, password):
            row=db.execute("SELECT password_salt FROM users WHERE username=?",(username,)).fetchone()
            salt=row[0] if row else secrets.token_hex(16)
            digest=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=2**14,r=8,p=1).hex()
            db.execute("INSERT INTO users(username,role,password_salt,password_hash) VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET role=excluded.role,password_salt=excluded.password_salt,password_hash=excluded.password_hash",(username,role,salt,digest))
        provision("admin","admin",ADMIN_PASSWORD)
        db.executemany("INSERT OR IGNORE INTO user_command_centers VALUES('admin',?)",[(c[0],) for c in CENTERS])
        for center_id, center_name, *_ in CENTERS:
            if center_id == "all": continue
            username="operator" if center_id=="ahmedabad" else f"operator.{center_id}"
            provision(username,"operator",OPERATOR_PASSWORD)
            db.execute("INSERT OR IGNORE INTO user_command_centers VALUES(?,?)",(username,center_id))
        db.execute("UPDATE cameras SET command_center_id='ahmedabad' WHERE command_center_id IS NULL")
        if db.execute("SELECT COUNT(*) FROM cameras").fetchone()[0] == 0:
            stamp = now()
            cameras = [
                ("C001", "Law Garden Junction", "Ahmedabad Traffic Police", 23.0225, 72.5714, "Traffic", "SIMULATOR", "sim://ahmedabad/law-garden", "Online", stamp, "West Zone", "Edge buffer 24h"),
                ("C002", "RTO Checkpoint", "RTO Ahmedabad", 23.0350, 72.5600, "Checkpoint", "SIMULATOR", "sim://ahmedabad/rto", "Online", stamp, "West Zone", "Edge buffer 24h"),
                ("C003", "Riverfront Entry", "Ahmedabad City Police", 23.0355, 72.5720, "Perimeter", "SIMULATOR", "sim://ahmedabad/riverfront", "Degraded", stamp, "Central Zone", "Edge buffer 12h"),
                ("C004", "Maninagar Circle", "Ahmedabad Traffic Police", 22.9970, 72.6000, "Traffic", "SIMULATOR", "sim://ahmedabad/maninagar", "Offline", stamp, "South Zone", "Edge buffer 12h"),
            ]
            db.executemany("INSERT INTO cameras(id,name,department,latitude,longitude,camera_type,protocol,endpoint_ref,status,last_heartbeat,zone,storage,created_at,updated_at,command_center_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [c + (stamp, stamp, "ahmedabad") for c in cameras])
        city_cameras = [
            ("SURAT-01", "Ring Road Junction", "Surat City Traffic", 21.1959, 72.8302, "Traffic", "surat", "Central Zone"),
            ("VAD-01", "Sayajigunj Crossing", "Vadodara Traffic", 22.3101, 73.1812, "Traffic", "vadodara", "Central Zone"),
            ("RAJ-01", "Race Course Road", "Rajkot Traffic", 22.2988, 70.7914, "Traffic", "rajkot", "West Zone"),
            ("GND-01", "Sachivalaya Gate", "Gandhinagar Police", 23.2230, 72.6490, "Perimeter", "gandhinagar", "Capital Zone"),
            ("JAI-01", "MI Road Junction", "Jaipur Traffic", 26.9160, 75.8120, "Traffic", "jaipur", "Central Zone"),
            ("MUM-01", "Fort District Entry", "Mumbai Traffic", 18.9322, 72.8347, "Perimeter", "mumbai", "South Zone"),
            ("BHO-01", "New Market Crossing", "Bhopal Traffic", 23.2324, 77.4011, "Traffic", "bhopal", "Central Zone"),
        ]
        for cid, name, department, lat, lon, camera_type, center_id, zone in city_cameras:
            db.execute("INSERT OR IGNORE INTO cameras(id,name,department,latitude,longitude,camera_type,protocol,endpoint_ref,status,last_heartbeat,zone,storage,created_at,updated_at,command_center_id) VALUES(?,?,?,?,?,?,'SIMULATOR',?,'Online',?,?, 'Edge buffer 24h',?,?,?)", (cid,name,department,lat,lon,camera_type,f"sim://{center_id}/{cid.lower()}",stamp,zone,stamp,stamp,center_id))
        if db.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0] == 0:
            db.executemany("INSERT INTO watchlist(identifier,entity_type,reason,priority,active,created_at) VALUES(?,?,?,?,1,?)", [
                ("GJ01AB1234", "Vehicle", "Synthetic stolen-vehicle training record", "High", now()),
                ("GJ05CD6789", "Vehicle", "Synthetic investigation record", "Medium", now()),
            ])
        if db.execute("SELECT COUNT(*) FROM detections").fetchone()[0] == 0:
            samples = [
                ("GJ01AB1234", "C001", 43, 0.94, "Car", "seed-watchlist-c001"),
                ("GJ02XY4567", "C001", 35, 0.89, "Motorcycle", "seed-vehicle-c001"),
                ("GJ01AB1234", "C002", 24, 0.97, "Car", "seed-watchlist-c002"),
                ("GJ01AB1234", "C003", 8, 0.91, "Car", "seed-watchlist-c003"),
            ]
            for plate, camera_id, minutes_ago, confidence, vehicle_type, source_id in samples:
                seen = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat(timespec="seconds").replace("+00:00", "Z")
                match = db.execute("SELECT id FROM watchlist WHERE identifier=? AND active=1", (plate,)).fetchone()
                event_id = db.execute("""INSERT INTO detections(camera_id,timestamp,vehicle_number,confidence,vehicle_type,event_type,bounding_box,source_id,matched_watchlist_id)
                  VALUES(?,?,?,?,?,'ANPR',?,?,?)""", (camera_id, seen, plate, confidence, vehicle_type, json.dumps({"x": 0.34, "y": 0.46, "width": 0.2, "height": 0.14}), source_id, match["id"] if match else None)).lastrowid
                if match:
                    db.execute("INSERT INTO alerts(detection_id,watchlist_id,status,created_at,updated_at) VALUES(?,?,'Open',?,?)", (event_id, match["id"], seen, seen))


def camera_health_monitor() -> None:
    """Refresh simulator heartbeats and mark silent external sources offline."""
    while True:
        time.sleep(15)
        stamp = now()
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat(timespec="seconds").replace("+00:00", "Z")
        changes = []
        with DB_LOCK, connect() as db:
            db.execute("UPDATE cameras SET last_heartbeat=?,updated_at=? WHERE protocol='SIMULATOR' AND status!='Offline'", (stamp, stamp))
            silent = db.execute("SELECT id FROM cameras WHERE protocol!='SIMULATOR' AND status!='Offline' AND last_heartbeat<?", (cutoff,)).fetchall()
            for row in silent:
                cid = row["id"]
                db.execute("UPDATE cameras SET status='Offline',updated_at=? WHERE id=?", (stamp, cid))
                db.execute("INSERT INTO audit_log(actor,action,target,details,timestamp) VALUES(?,?,?,?,?)", ("system", "camera.heartbeat_timeout", cid, json.dumps({"threshold_seconds": 90}), stamp))
                changes.append(dict(db.execute("SELECT * FROM cameras WHERE id=?", (cid,)).fetchone()))
        for camera in changes:
            publish("camera", camera)


def publish(kind: str, payload: dict) -> None:
    message = json.dumps({"type": kind, "data": payload})
    for subscriber, username, role, center_id in list(SUBSCRIBERS):
        if kind in ("camera", "detection", "alert"):
            if center_id != "all" and payload.get("command_center_id") != center_id: continue
            if role != "admin" and kind in ("detection", "alert") and payload.get("owner_user") not in (None, username): continue
        try:
            subscriber.put_nowait(message)
        except queue.Full:
            try:
                subscriber.get_nowait()
                subscriber.put_nowait(message)
            except queue.Empty:
                pass


def rowdict(row):
    return dict(row) if row else None


class API(BaseHTTPRequestHandler):
    server_version = "OkDriverDemo/1.0"

    def log_message(self, fmt, *args):
        print(f"[{now()}] {self.address_string()} {fmt % args}")

    def send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        length = min(int(self.headers.get("Content-Length", "0")), 1_000_000)
        try:
            value = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(value, dict):
                raise ValueError("JSON body must be an object")
            return value
        except (json.JSONDecodeError, ValueError):
            raise ValueError("Request body must be a valid JSON object")

    def auth(self, roles=("admin", "operator")):
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        try:
            user, expiry, signature = token.rsplit(".", 2)
            valid = int(expiry) > int(time.time()) and hmac.compare_digest(
                signature, hmac.new(TOKEN_KEY.encode(), f"{user}.{expiry}".encode(), hashlib.sha256).hexdigest())
        except (ValueError, TypeError):
            valid = False
            user = ""
        role = None
        center_id = self.headers.get("X-Command-Center-ID", "ahmedabad").lower()
        try:
            with connect() as db:
                account = db.execute("SELECT role,active FROM users WHERE username=?", (user,)).fetchone()
                memberships = {r[0] for r in db.execute("SELECT command_center_id FROM user_command_centers WHERE username=?", (user,))}
                role = account["role"] if account and account["active"] else None
        except sqlite3.Error:
            memberships = set()
        if role == "admin": center_id = center_id if center_id in {c[0] for c in CENTERS} else "ahmedabad"
        elif center_id not in memberships: center_id = next(iter(memberships), "ahmedabad")
        self.current_user, self.current_role, self.center_id = user, role, center_id
        if not valid or role not in roles:
            self.send_json({"error": "Authentication required"}, 401)
            return None
        return user

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/health":
            return self.send_json({"ok": True, "service": "okDriver Sentinel", "time": now(), "demo_mode": DEMO_MODE})
        if path == "/api/events/stream":
            if not self.auth(): return
            return self.stream()
        if path == "/" or path.startswith("/static/") or path.startswith("/assets/"):
            return self.static(path)
        if not path.startswith("/api/"):
            return self.send_json({"error": "Not found"}, 404)
        if not self.auth(): return
        try:
            with DB_LOCK, connect() as db:
                if path == "/api/bootstrap":
                    cameras = [dict(r) for r in db.execute("SELECT * FROM cameras WHERE (?='all' OR command_center_id=?) ORDER BY id", (self.center_id,self.center_id))]
                    detections = [dict(r) for r in db.execute("""SELECT d.*,c.name camera_name,c.latitude,c.longitude,w.reason watchlist_reason
                      FROM detections d JOIN cameras c ON c.id=d.camera_id LEFT JOIN watchlist w ON w.id=d.matched_watchlist_id
                      WHERE (?='all' OR c.command_center_id=?) AND (?='admin' OR d.owner_user IS NULL OR d.owner_user=?) ORDER BY d.timestamp DESC LIMIT 300""", (self.center_id,self.center_id,self.current_role,self.current_user))]
                    alerts = self.get_alert_rows(db)
                    watchlist = [dict(r) for r in db.execute("SELECT * FROM watchlist ORDER BY active DESC,priority,id")]
                    audit = [dict(r) for r in db.execute("SELECT * FROM audit_log WHERE (?='admin' OR actor_role='admin' OR actor='system' OR actor=?) ORDER BY id DESC LIMIT 100", (self.current_role,self.current_user))]
                    centers = [dict(r) for r in db.execute("SELECT c.* FROM command_centers c JOIN user_command_centers u ON u.command_center_id=c.id WHERE u.username=? ORDER BY c.name",(self.current_user,))]
                    return self.send_json({"cameras": cameras, "detections": detections, "alerts": alerts, "watchlist": watchlist, "audit": audit,"command_centers":centers,"selected_center":self.center_id,"user":{"username":self.current_user,"role":self.current_role}})
                if path == "/api/cameras":
                    q = parse_qs(parsed.query); term = q.get("q", [""])[0].lower(); status = q.get("status", [""])[0]
                    cams = [dict(r) for r in db.execute("SELECT * FROM cameras WHERE (?='all' OR command_center_id=?) ORDER BY id",(self.center_id,self.center_id))]
                    return self.send_json([c for c in cams if (not status or c["status"] == status) and (not term or term in json.dumps(c).lower())])
                if path == "/api/watchlist":
                    return self.send_json([dict(r) for r in db.execute("SELECT * FROM watchlist ORDER BY id DESC")])
                if path == "/api/alerts":
                    return self.send_json(self.get_alert_rows(db))
                if path == "/api/entities":
                    term = parse_qs(parsed.query).get("q", [""])[0].upper().strip()
                    summaries = [dict(r) for r in db.execute("""SELECT vehicle_number,COUNT(*) detection_count,
                      MIN(timestamp) first_seen,MAX(timestamp) last_seen FROM detections d JOIN cameras c ON c.id=d.camera_id
                      WHERE vehicle_number LIKE ? AND (?='all' OR c.command_center_id=?) AND (?='admin' OR d.owner_user IS NULL OR d.owner_user=?)
                      GROUP BY vehicle_number ORDER BY last_seen DESC""", (f"%{term}%",self.center_id,self.center_id,self.current_role,self.current_user))]
                    for entity in summaries:
                        latest = db.execute("""SELECT c.id camera_id,c.name camera_name,c.latitude,c.longitude,d.confidence,d.timestamp
                          FROM detections d JOIN cameras c ON c.id=d.camera_id WHERE d.vehicle_number=? AND (?='all' OR c.command_center_id=?) AND (?='admin' OR d.owner_user IS NULL OR d.owner_user=?)
                          ORDER BY d.timestamp DESC,d.id DESC LIMIT 1""", (entity["vehicle_number"],self.center_id,self.center_id,self.current_role,self.current_user)).fetchone()
                        entity["last_camera_id"] = latest["camera_id"]
                        entity["last_camera"] = latest["camera_name"]
                        entity["latitude"] = latest["latitude"]
                        entity["longitude"] = latest["longitude"]
                    return self.send_json({"items": summaries, "total": len(summaries), "query": term})
                if path == "/api/events":
                    query = parse_qs(parsed.query)
                    term = query.get("q", [""])[0].upper().strip()
                    camera_id = query.get("camera_id", [""])[0].upper().strip()
                    try: limit = min(max(int(query.get("limit", ["200"])[0]), 1), 1000)
                    except ValueError: return self.send_json({"error": "limit must be an integer"}, 400)
                    rows = [dict(r) for r in db.execute("""SELECT d.*,c.name camera_name,c.latitude,c.longitude,w.reason watchlist_reason
                      FROM detections d JOIN cameras c ON c.id=d.camera_id LEFT JOIN watchlist w ON w.id=d.matched_watchlist_id
                      WHERE d.vehicle_number LIKE ? AND d.camera_id LIKE ? AND (?='all' OR c.command_center_id=?) AND (?='admin' OR d.owner_user IS NULL OR d.owner_user=?) ORDER BY d.timestamp DESC,d.id DESC LIMIT ?""",
                      (f"%{term}%", f"%{camera_id}%",self.center_id,self.center_id,self.current_role,self.current_user,limit))]
                    return self.send_json({"items": rows, "total": len(rows), "limit": limit})
                if path == "/api/entities/search":
                    query = parse_qs(parsed.query)
                    term = query.get("q", [""])[0].upper().strip()
                    exact = query.get("exact", [""])[0].lower() == "true"
                    operator = "=" if exact else "LIKE"
                    value = term if exact else f"%{term}%"
                    rows = [dict(r) for r in db.execute("""SELECT d.*,c.name camera_name,c.latitude,c.longitude FROM detections d JOIN cameras c ON c.id=d.camera_id
                      WHERE d.vehicle_number """ + operator + " ? AND (?='all' OR c.command_center_id=?) AND (?='admin' OR d.owner_user IS NULL OR d.owner_user=?) ORDER BY d.timestamp ASC,d.id ASC", (value,self.center_id,self.center_id,self.current_role,self.current_user))]
                    return self.send_json({"query": term, "events": rows})
                return self.send_json({"error": "Not found"}, 404)
        except sqlite3.Error as exc:
            return self.send_json({"error": str(exc)}, 500)

    def get_alert_rows(self, db):
        return [dict(r) for r in db.execute("""SELECT a.*,d.camera_id,d.vehicle_number,d.confidence,d.timestamp,
          c.name camera_name,c.latitude,c.longitude,c.command_center_id,w.reason,w.priority,w.entity_type,w.active identifier_active FROM alerts a
          JOIN detections d ON d.id=a.detection_id JOIN cameras c ON c.id=d.camera_id JOIN watchlist w ON w.id=a.watchlist_id
          WHERE (?='all' OR c.command_center_id=?) AND (?='admin' OR a.owner_user IS NULL OR a.owner_user=?)
          ORDER BY CASE a.status WHEN 'Open' THEN 0 WHEN 'Acknowledged' THEN 1 ELSE 2 END,a.created_at DESC LIMIT 1000""", (self.center_id,self.center_id,self.current_role,self.current_user))]

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            try: data = self.body()
            except ValueError as e: return self.send_json({"error": str(e)}, 400)
            user, password = str(data.get("username", "")), str(data.get("password", ""))
            with connect() as db: account=db.execute("SELECT * FROM users WHERE username=? AND active=1",(user,)).fetchone()
            if not account: return self.send_json({"error": "Invalid username or password"}, 401)
            candidate=hashlib.scrypt(password.encode(),salt=bytes.fromhex(account["password_salt"]),n=2**14,r=8,p=1).hex()
            if not hmac.compare_digest(candidate,account["password_hash"]): return self.send_json({"error": "Invalid username or password"}, 401)
            exp = str(int(time.time()) + 8 * 3600)
            sig = hmac.new(TOKEN_KEY.encode(), f"{user}.{exp}".encode(), hashlib.sha256).hexdigest()
            with connect() as db: assigned=[dict(r) for r in db.execute("SELECT c.* FROM command_centers c JOIN user_command_centers u ON u.command_center_id=c.id WHERE u.username=? ORDER BY c.name",(user,))]
            return self.send_json({"token": f"{user}.{exp}.{sig}", "user": user, "role": account["role"], "command_centers":assigned,"expires_in":28800})
        if not self.auth(): return
        actor = self.auth_user
        try:
            data = self.body()
            with DB_LOCK, connect() as db:
                if path == "/api/cameras":
                    if actor != "admin": return self.send_json({"error": "Admin role required"}, 403)
                    required = ["id", "name", "department", "latitude", "longitude", "camera_type", "protocol", "endpoint_ref", "zone"]
                    missing = [key for key in required if not str(data.get(key, "")).strip()]
                    if missing: return self.send_json({"error": "Required fields: " + ", ".join(missing)}, 400)
                    try: lat, lon = float(data["latitude"]), float(data["longitude"])
                    except (TypeError, ValueError): return self.send_json({"error": "Latitude and longitude must be numeric"}, 400)
                    if not (-90 <= lat <= 90 and -180 <= lon <= 180): return self.send_json({"error": "Coordinates are out of range"}, 400)
                    stamp = now(); cid = str(data["id"]).strip().upper()
                    camera_center = self.center_id if self.center_id != "all" else str(data.get("command_center_id", "ahmedabad")).lower()
                    if camera_center not in {c[0] for c in CENTERS if c[0] != "all"}: return self.send_json({"error": "Select a valid city command center"}, 400)
                    status = data.get("status", "Online")
                    if status not in ("Online", "Offline", "Degraded"): return self.send_json({"error": "Invalid camera status"}, 400)
                    try:
                        db.execute("INSERT INTO cameras(id,name,department,latitude,longitude,camera_type,protocol,endpoint_ref,status,last_heartbeat,zone,storage,created_at,updated_at,command_center_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (cid, str(data["name"]).strip(), str(data["department"]).strip(), lat, lon, str(data["camera_type"]), str(data["protocol"]).upper(), str(data["endpoint_ref"]).strip(), status, stamp, str(data["zone"]).strip(), str(data.get("storage", "Edge buffer 24h")), stamp, stamp, camera_center))
                    except sqlite3.IntegrityError: return self.send_json({"error": "Camera ID already exists"}, 409)
                    self.audit(db, actor, "camera.created", cid, {"name": data["name"]})
                    result = dict(db.execute("SELECT * FROM cameras WHERE id=?", (cid,)).fetchone())
                    publish("camera", result); return self.send_json(result, 201)
                if path == "/api/events":
                    required = ["camera_id", "vehicle_number", "confidence", "vehicle_type", "event_type", "source_id"]
                    if any(data.get(k) in (None, "") for k in required): return self.send_json({"error": "Missing required event fields"}, 400)
                    try: confidence = float(data["confidence"])
                    except (ValueError, TypeError): return self.send_json({"error": "Confidence must be numeric"}, 400)
                    if not (0 <= confidence <= 1): return self.send_json({"error": "Confidence must be between 0 and 1"}, 400)
                    timestamp = str(data.get("timestamp") or now())
                    if len(timestamp) > 40: return self.send_json({"error": "Invalid timestamp"}, 400)
                    cam = db.execute("SELECT * FROM cameras WHERE id=?", (str(data["camera_id"]).upper(),)).fetchone()
                    if not cam: return self.send_json({"error": "Unknown camera_id"}, 404)
                    if self.center_id != "all" and cam["command_center_id"] != self.center_id: return self.send_json({"error": "Camera is outside your command center"}, 403)
                    vehicle = str(data["vehicle_number"]).upper().strip()[:24]
                    match = db.execute("SELECT * FROM watchlist WHERE identifier=? AND active=1", (vehicle,)).fetchone()
                    try:
                        cur = db.execute("INSERT INTO detections(camera_id,timestamp,vehicle_number,confidence,vehicle_type,event_type,bounding_box,source_id,matched_watchlist_id,owner_user) VALUES(?,?,?,?,?,?,?,?,?,?)",
                          (cam["id"], timestamp, vehicle, confidence, str(data["vehicle_type"])[:40], str(data["event_type"])[:40], json.dumps(data.get("bounding_box")), str(data["source_id"])[:120], match["id"] if match else None, self.current_user))
                    except sqlite3.IntegrityError: return self.send_json({"error": "Duplicate event source_id", "duplicate": True}, 409)
                    event = dict(db.execute("SELECT d.*,c.name camera_name,c.latitude,c.longitude,c.command_center_id FROM detections d JOIN cameras c ON c.id=d.camera_id WHERE d.id=?", (cur.lastrowid,)).fetchone())
                    alert = None
                    if match:
                        stamp = now(); alert_id = db.execute("INSERT INTO alerts(detection_id,watchlist_id,status,created_at,updated_at,owner_user) VALUES(?,?, 'Open',?,?,?)", (cur.lastrowid, match["id"], stamp, stamp,self.current_user)).lastrowid
                        alert = dict(db.execute("SELECT a.*,d.camera_id,d.vehicle_number,d.confidence,d.timestamp,c.name camera_name,c.latitude,c.longitude,c.command_center_id,w.reason,w.priority,w.entity_type,w.active identifier_active FROM alerts a JOIN detections d ON d.id=a.detection_id JOIN cameras c ON c.id=d.camera_id JOIN watchlist w ON w.id=a.watchlist_id WHERE a.id=?", (alert_id,)).fetchone())
                    self.audit(db, actor, "detection.received", str(cur.lastrowid), {"camera_id": cam["id"], "vehicle_number": vehicle, "matched": bool(match)})
                    publish("detection", event)
                    if alert: publish("alert", alert)
                    return self.send_json({"event": event, "alert": alert, "watchlist_match": bool(match)}, 201)
                if path.startswith("/api/cameras/") and path.endswith("/heartbeat"):
                    cid = path.split("/")[-2].upper()
                    if self.current_role != "admin":
                        owned=db.execute("SELECT command_center_id FROM cameras WHERE id=?",(cid,)).fetchone()
                        if not owned or owned["command_center_id"]!=self.center_id: return self.send_json({"error":"Camera is outside your command center"},403)
                    status = data.get("status", "Online")
                    if status not in ("Online", "Offline", "Degraded"): return self.send_json({"error": "Invalid camera status"}, 400)
                    cur = db.execute("UPDATE cameras SET status=?,last_heartbeat=?,updated_at=? WHERE id=?", (status, now(), now(), cid))
                    if cur.rowcount == 0: return self.send_json({"error": "Camera not found"}, 404)
                    self.audit(db, actor, "camera.heartbeat", cid, {"status": status})
                    result = dict(db.execute("SELECT * FROM cameras WHERE id=?", (cid,)).fetchone())
                    publish("camera", result); return self.send_json(result)
                if path == "/api/watchlist":
                    if actor != "admin": return self.send_json({"error": "Admin role required"}, 403)
                    ident = str(data.get("identifier", "")).upper().strip()
                    if not ident or len(ident) > 32: return self.send_json({"error": "Valid identifier is required"}, 400)
                    try:
                        cur = db.execute("INSERT INTO watchlist(identifier,entity_type,reason,priority,active,created_at) VALUES(?,?,?,?,1,?)", (ident, str(data.get("entity_type", "Vehicle")), str(data.get("reason", "Operator-added watchlist entry"))[:200], data.get("priority", "Medium"), now()))
                    except sqlite3.IntegrityError: return self.send_json({"error": "Identifier already exists"}, 409)
                    result = dict(db.execute("SELECT * FROM watchlist WHERE id=?", (cur.lastrowid,)).fetchone())
                    self.audit(db, actor, "watchlist.created", str(result["id"]), {"identifier": ident}); publish("watchlist", result)
                    return self.send_json(result, 201)
                return self.send_json({"error": "Not found"}, 404)
        except (sqlite3.Error, TypeError) as exc:
            return self.send_json({"error": str(exc)}, 500)

    def do_PATCH(self):
        if not self.auth(): return
        actor = self.auth_user
        path = urlparse(self.path).path
        try: data = self.body()
        except ValueError as e: return self.send_json({"error": str(e)}, 400)
        if path.startswith("/api/cameras/"):
            if actor != "admin": return self.send_json({"error": "Admin role required"}, 403)
            cid = path.rsplit("/", 1)[-1].upper()
            allowed = {"name", "department", "latitude", "longitude", "camera_type", "protocol", "endpoint_ref", "status", "zone", "storage"}
            changes = {k: v for k, v in data.items() if k in allowed}
            if "status" in changes and changes["status"] not in ("Online", "Offline", "Degraded"): return self.send_json({"error": "Invalid camera status"}, 400)
            try:
                for coordinate, low, high in (("latitude", -90, 90), ("longitude", -180, 180)):
                    if coordinate in changes:
                        changes[coordinate] = float(changes[coordinate])
                        if not low <= changes[coordinate] <= high: return self.send_json({"error": "Coordinates are out of range"}, 400)
            except (ValueError, TypeError):
                return self.send_json({"error": "Latitude and longitude must be numeric"}, 400)
            if not changes: return self.send_json({"error": "No editable fields supplied"}, 400)
            changes["updated_at"] = now()
            with DB_LOCK, connect() as db:
                if not db.execute("SELECT 1 FROM cameras WHERE id=?", (cid,)).fetchone(): return self.send_json({"error": "Camera not found"}, 404)
                db.execute("UPDATE cameras SET " + ",".join(f"{k}=?" for k in changes) + " WHERE id=?", (*changes.values(), cid))
                self.audit(db, actor, "camera.updated", cid, changes)
                row = dict(db.execute("SELECT * FROM cameras WHERE id=?", (cid,)).fetchone())
            publish("camera", row); return self.send_json(row)
        if path.startswith("/api/alerts/"):
            aid = path.rsplit("/", 1)[-1]
            status = data.get("status")
            if status not in ("Acknowledged", "Resolved"): return self.send_json({"error": "Status must be Acknowledged or Resolved"}, 400)
            with DB_LOCK, connect() as db:
                cur = db.execute("UPDATE alerts SET status=?,updated_at=? WHERE id=? AND (?='all' OR detection_id IN (SELECT d.id FROM detections d JOIN cameras c ON c.id=d.camera_id WHERE c.command_center_id=?)) AND (?='admin' OR (owner_user IS NULL OR owner_user=?))", (status, now(), aid,self.center_id,self.center_id,self.current_role,self.current_user))
                if cur.rowcount == 0: return self.send_json({"error": "Alert not found"}, 404)
                self.audit(db, actor, "alert." + status.lower(), aid, {})
                result = next(a for a in self.get_alert_rows(db) if str(a["id"]) == aid)
            publish("alert", result); return self.send_json(result)
        if path.startswith("/api/watchlist/"):
            if actor != "admin": return self.send_json({"error": "Admin role required"}, 403)
            wid = path.rsplit("/", 1)[-1]
            active = data.get("active")
            if not isinstance(active, bool): return self.send_json({"error": "active must be a boolean"}, 400)
            with DB_LOCK, connect() as db:
                cur = db.execute("UPDATE watchlist SET active=? WHERE id=?", (int(active), wid))
                if cur.rowcount == 0: return self.send_json({"error": "Watchlist entry not found"}, 404)
                self.audit(db, actor, "watchlist.updated", wid, {"active": active})
                result = dict(db.execute("SELECT * FROM watchlist WHERE id=?", (wid,)).fetchone())
            publish("watchlist", result); return self.send_json(result)
        return self.send_json({"error": "Not found"}, 404)

    def audit(self, db, actor, action, target, details):
        db.execute("INSERT INTO audit_log(actor,action,target,details,timestamp,actor_role,command_center_id) VALUES(?,?,?,?,?,?,?)", (actor, action, target, json.dumps(details), now(), getattr(self,"current_role","system"),getattr(self,"center_id",None)))

    @property
    def auth_user(self):
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        try: return token.rsplit(".", 2)[0]
        except Exception: return "unknown"

    def stream(self):
        sub = queue.Queue(maxsize=100); subscriber = (sub,self.current_user,self.current_role,self.center_id); SUBSCRIBERS.append(subscriber)
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-cache"); self.send_header("Connection", "keep-alive"); self.send_header("X-Accel-Buffering", "no"); self.end_headers()
        try:
            self.wfile.write(b": connected\n\n"); self.wfile.flush()
            while True:
                try: message = sub.get(timeout=20); raw = f"data: {message}\n\n".encode()
                except queue.Empty: raw = b": heartbeat\n\n"
                self.wfile.write(raw); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError): pass
        finally:
            if subscriber in SUBSCRIBERS: SUBSCRIBERS.remove(subscriber)

    def static(self, path):
        dist_root = ROOT / "frontend" / "dist"
        static_root = (dist_root if (dist_root / "index.html").is_file() else ROOT / "static").resolve()
        if path == "/": target = static_root / "index.html"
        elif path.startswith("/static/"): target = (ROOT / path.lstrip("/")).resolve()
        else: target = (static_root / path.lstrip("/")).resolve()
        if target != static_root and static_root not in target.parents: return self.send_json({"error": "Not found"}, 404)
        if not target.is_file(): return self.send_json({"error": "Not found"}, 404)
        content_type = "text/html; charset=utf-8" if target.suffix == ".html" else "text/css; charset=utf-8" if target.suffix == ".css" else "text/javascript; charset=utf-8" if target.suffix == ".js" else "image/svg+xml" if target.suffix == ".svg" else "application/octet-stream"
        raw = target.read_bytes(); self.send_response(200); self.send_header("Content-Type", content_type); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)


if __name__ == "__main__":
    initialize()
    threading.Thread(target=camera_health_monitor, daemon=True, name="camera-health-monitor").start()
    print(f"okDriver Sentinel demo running at http://{HOST}:{PORT} (demo mode={DEMO_MODE})")
    ThreadingHTTPServer((HOST, PORT), API).serve_forever()
