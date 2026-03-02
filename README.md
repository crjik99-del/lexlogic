# Platform Anotasi HAM
### Cloudflare Workers + D1 + GitHub Auto-Deploy

Infrastruktur ini bekerja persis seperti website Anda yang sudah ada:
**edit di PC → commit → push → Cloudflare auto-deploy.**

---

## Arsitektur

```
PC Lokal Anda
  │ edit kode → git commit → git push
  ▼
GitHub (branch: main)
  │ GitHub Actions trigger otomatis
  ▼
Cloudflare Workers (app + API)
  │ connected ke
  ├─► Cloudflare D1 (database SQLite serverless)
  │
  │ Cron 00:00 WIB setiap hari
  ▼
GitHub (branch: data-backup)
  │ git pull via script Python
  ▼
PC Lokal (sinkronisasi data anotasi)
```

---

## Setup Pertama Kali (±30 menit)

### 1. Install tools

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Wrangler (Cloudflare CLI)
bun install -g wrangler

# Login ke Cloudflare
wrangler login
```

### 2. Buat D1 Database

```bash
wrangler d1 create ham-annotation-db
```

Output akan menampilkan:
```
✅ Successfully created DB 'ham-annotation-db'
[[d1_databases]]
binding = "DB"
database_name = "ham-annotation-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   ← COPY INI
```

**Paste `database_id` ke `wrangler.toml`** (baris `database_id`).

### 3. Buat GitHub Repository

```bash
# Di GitHub: buat repo baru bernama "ham-annotation-app"
# Kemudian:
git init
git remote add origin https://github.com/USERNAME/ham-annotation-app.git

# Buat branch data-backup
git checkout -b data-backup
mkdir -p data
echo '{"info":"backup branch"}' > data/.gitkeep
git add . && git commit -m "init: backup branch"
git push -u origin data-backup

# Kembali ke main
git checkout -b main
```

### 4. Setup GitHub Secrets

Di GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret Name | Nilai |
|-------------|-------|
| `CLOUDFLARE_API_TOKEN` | Dari Cloudflare Dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Dari Cloudflare Dashboard → kanan bawah |

### 5. Setup Secrets di Wrangler (untuk production)

```bash
# Admin key (buat yang kuat, min 20 karakter)
wrangler secret put ADMIN_KEY
# → ketik admin key Anda, Enter

# GitHub token untuk backup (Settings → Developer Settings → Personal Access Tokens → Fine-grained)
# Permission yang dibutuhkan: Contents (Read & Write) pada repo ham-annotation-app
wrangler secret put GITHUB_TOKEN
# → paste token, Enter

# Gemini API key (Google AI Studio / Google Cloud)
wrangler secret put GEMINI_API_KEY
# → paste key, Enter
```

### 6. Update wrangler.toml

```toml
[vars]
ADMIN_KEY = "dev-only"          # hanya untuk lokal, production pakai secret
GITHUB_REPO = "USERNAME/ham-annotation-app"   # ← ganti USERNAME
GITHUB_BACKUP_BRANCH = "data-backup"
GEMINI_MODEL = "gemini-2.0-flash"
```

### 7. Install dependencies & build

```bash
bun install
bun run build:client
```

### 8. Inisialisasi D1 database

```bash
# Production D1
bun run d1:init        # buat tabel
bun run d1:seed-ham    # isi 16 parameter HAM

# Untuk development lokal (simulasi D1)
bun run d1:local
bun run d1:seed-local
```

### 9. Upload corpus dokumen ke D1

Edit `scripts/upload_corpus.py`:
```python
WORKER_URL = "https://ham-annotation.USERNAME.workers.dev"  # setelah deploy
ADMIN_KEY  = "admin-key-Anda"
CORPUS_PATH = Path("/path/ke/legal_corpus.json")  # atau expert_validation_sample.json
```

Jalankan setelah pertama kali deploy:
```bash
python scripts/upload_corpus.py
```

### 10. Deploy pertama kali

```bash
wrangler deploy
```

Atau push ke GitHub dan biarkan GitHub Actions yang deploy:
```bash
git add .
git commit -m "feat: initial deployment"
git push origin main
```

---

## Workflow Sehari-hari (sama seperti web Anda)

```bash
# Edit kode...
# Setelah selesai:
git add .
git commit -m "fix: perbaiki tampilan dashboard"
git push origin main
# → Cloudflare otomatis deploy dalam ~1 menit
```

---

## Menambah Pakar Baru

```bash
curl -X POST https://ham-annotation.USERNAME.workers.dev/api/admin/experts \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: ADMIN_KEY_ANDA" \
  -d '{"name":"Dr. Ahmad Fauzi","email":"ahmad@ui.ac.id","institution":"FH Universitas Indonesia","expertise":"Hukum HAM Internasional"}'
```

Response:
```json
{ "ok": true, "invite_code": "AHM-K4X9P2" }
```

Kirimkan `invite_code` via email ke pakar. Mereka buka URL → masuk kode → langsung bisa kerja.

---

## Cek Status & Export

```bash
# Statistik (buka di browser atau curl)
https://ham-annotation.USERNAME.workers.dev/api/admin/stats?admin_key=KUNCI

# Export JSON
https://ham-annotation.USERNAME.workers.dev/api/admin/export?admin_key=KUNCI

# Export CSV
https://ham-annotation.USERNAME.workers.dev/api/admin/export?admin_key=KUNCI&format=csv

# Trigger backup manual ke GitHub
curl -X POST https://ham-annotation.USERNAME.workers.dev/api/admin/backup-now?admin_key=KUNCI
```

---

## Sinkronisasi ke PC Lokal

### Manual
```bash
python scripts/sync_local.py
```

### Otomatis — Windows Task Scheduler
1. Buka Task Scheduler → Create Basic Task
2. Trigger: Daily, 07:00 WIB
3. Action: Start a program
   - Program: `python`
   - Arguments: `C:\path\to\scripts\sync_local.py`
   - Start in: `C:\path\to\ham-annotation-app`

### Otomatis — Linux/Mac (crontab)
```bash
crontab -e
# Tambahkan:
0 7 * * * cd /path/to/ham-annotation-app && python scripts/sync_local.py >> /var/log/ham-sync.log 2>&1
```

Data tersimpan di `./local_backups/`:
```
local_backups/
├── annotations-2025-01-15.json
├── annotations-2025-01-16.json
├── annotations-latest.json   ← selalu versi terbaru
└── sync.log
```

---

## Biaya

Semua **GRATIS** dengan Cloudflare free tier:

| Komponen | Limit Gratis | Estimasi Penggunaan |
|----------|--------------|---------------------|
| Workers | 100.000 req/hari | ~500 req/hari ✓ |
| D1 Database | 5 GB, 25M reads/hari | <100 MB, <10K reads/hari ✓ |
| GitHub Actions | 2.000 menit/bulan | ~5 menit/deploy ✓ |

---

## Troubleshooting

**Deploy gagal di GitHub Actions:**
Periksa secrets `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID` sudah benar.

**D1 database_id tidak ada:**
Jalankan `wrangler d1 list` untuk melihat ID database yang sudah dibuat.

**Backup ke GitHub gagal:**
Cek GITHUB_TOKEN punya permission `Contents: Read & Write` pada repo yang benar.
Test manual: `curl -X POST URL/api/admin/backup-now?admin_key=KUNCI`

**Pakar tidak bisa login:**
Cek invite_code sudah benar (case-sensitive, format XXX-XXXXXX).
# lexlogic
