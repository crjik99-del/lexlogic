#!/usr/bin/env python3
# scripts/upload_corpus.py
# Jalankan dari PC lokal untuk upload corpus ke D1 via Workers API
# Usage: python scripts/upload_corpus.py

import json
import sys
import math
import urllib.request
import urllib.error
from pathlib import Path

# ── KONFIGURASI ────────────────────────────────────────────────────────────────
WORKER_URL   = "https://ham-annotation.SUBDOMAIN.workers.dev"  # ganti dengan URL Worker Anda
ADMIN_KEY    = "GANTI_ADMIN_KEY_ANDA"
CORPUS_PATH  = Path("../corpus_v1/expert_validation_sample_full.json")  # path ke legal_corpus.json Anda
BATCH_SIZE   = 20  # dokumen per request (jaga agar tidak timeout)
# ──────────────────────────────────────────────────────────────────────────────

def post_json(url: str, data: dict, headers: dict = {}) -> dict:
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        **headers
    }, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}")
        raise

def main():
    # Load corpus
    if not CORPUS_PATH.exists():
        print(f"❌ File tidak ditemukan: {CORPUS_PATH}")
        print(f"   Sesuaikan CORPUS_PATH di script ini")
        sys.exit(1)

    print(f"📖 Membaca corpus dari {CORPUS_PATH}...")
    with open(CORPUS_PATH, "r", encoding="utf-8") as f:
        corpus = json.load(f)

    # Bisa jadi list langsung atau dict dengan key 'documents'
    if isinstance(corpus, dict):
        docs = corpus.get("documents", corpus.get("annotations", []))
    else:
        docs = corpus

    total = len(docs)
    print(f"   {total} dokumen ditemukan")

    if total == 0:
        print("❌ Tidak ada dokumen. Periksa format file corpus.")
        sys.exit(1)

    # Upload dalam batch
    batches = math.ceil(total / BATCH_SIZE)
    uploaded = 0
    headers = {"X-Admin-Key": ADMIN_KEY}

    print(f"\n⬆️  Mengupload {total} dokumen dalam {batches} batch...\n")

    for i in range(batches):
        batch = docs[i * BATCH_SIZE : (i + 1) * BATCH_SIZE]
        print(f"   Batch {i+1}/{batches} ({len(batch)} docs)...", end=" ", flush=True)

        try:
            result = post_json(
                f"{WORKER_URL}/api/admin/load-documents",
                {"documents": batch},
                headers
            )
            uploaded += result.get("inserted", len(batch))
            print(f"✓ ({result.get('inserted', '?')} inserted)")
        except Exception as e:
            print(f"❌ Error: {e}")
            print(f"   Melanjutkan ke batch berikutnya...")

    print(f"\n✅ Selesai! {uploaded}/{total} dokumen berhasil diupload ke D1")
    print(f"   Cek: {WORKER_URL}/api/admin/stats?admin_key={ADMIN_KEY}")

if __name__ == "__main__":
    main()
