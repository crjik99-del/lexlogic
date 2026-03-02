#!/usr/bin/env python3
# scripts/sync_local.py
# Sinkronisasi hasil anotasi dari GitHub backup branch ke PC lokal
# Jalankan manual atau jadwalkan via Task Scheduler (Windows) / cron (Linux/Mac)
#
# Windows Task Scheduler: setiap hari jam 07:00
#   Action: python C:\path\to\scripts\sync_local.py
#
# Linux/Mac cron (crontab -e):
#   0 7 * * * cd /path/to/project && python scripts/sync_local.py

import json
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime

# ── KONFIGURASI ────────────────────────────────────────────────────────────────
GITHUB_REPO          = "username/ham-annotation-app"         # ganti
GITHUB_BACKUP_BRANCH = "data-backup"
GITHUB_TOKEN         = ""  # opsional, untuk repo private
LOCAL_BACKUP_DIR     = Path("./local_backups")                # folder penyimpanan lokal
# ──────────────────────────────────────────────────────────────────────────────

def get_json(url: str, token: str = "") -> any:
    headers = {"User-Agent": "ham-sync-script"}
    if token:
        headers["Authorization"] = f"token {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))

def download_file(url: str, token: str = "") -> bytes:
    headers = {"User-Agent": "ham-sync-script"}
    if token:
        headers["Authorization"] = f"token {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()

def main():
    LOCAL_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOCAL_BACKUP_DIR / "sync.log"
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print(f"[{ts}] Mulai sinkronisasi dari GitHub...")

    try:
        # Ambil daftar file di folder data/ pada backup branch
        api_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/data?ref={GITHUB_BACKUP_BRANCH}"
        files = get_json(api_url, GITHUB_TOKEN)

        if not isinstance(files, list):
            raise ValueError(f"Unexpected response: {files}")

        json_files = [f for f in files if f["name"].endswith(".json")]
        print(f"   {len(json_files)} file backup ditemukan di GitHub")

        downloaded = 0
        for file_info in json_files:
            local_path = LOCAL_BACKUP_DIR / file_info["name"]

            # Skip jika sudah ada dan ukuran sama
            if local_path.exists() and local_path.stat().st_size == file_info.get("size", 0):
                print(f"   ⊙ {file_info['name']} (sudah ada, skip)")
                continue

            print(f"   ↓ {file_info['name']} ({file_info.get('size', '?')} bytes)...", end=" ")
            content = download_file(file_info["download_url"], GITHUB_TOKEN)
            local_path.write_bytes(content)
            print(f"✓")
            downloaded += 1

        # Buat ringkasan dari annotations-latest.json
        latest_path = LOCAL_BACKUP_DIR / "annotations-latest.json"
        if latest_path.exists():
            with open(latest_path, "r", encoding="utf-8") as f:
                latest = json.load(f)
            stats = latest.get("stats", {})
            count = latest.get("count", 0)
            print(f"\n   📊 Status terakhir:")
            print(f"      Dokumen      : {stats.get('total_documents', '?')}")
            print(f"      Pakar aktif  : {stats.get('total_experts', '?')}")
            print(f"      Total anotasi: {stats.get('total_annotations', '?')}")
            print(f"      Selesai      : {stats.get('completed_annotations', '?')}")

        msg = f"[{ts}] OK — {downloaded} file baru didownload"
        print(f"\n✅ {msg}")
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(msg + "\n")

    except Exception as e:
        msg = f"[{ts}] ERROR — {e}"
        print(f"❌ {msg}")
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
        raise

if __name__ == "__main__":
    main()
