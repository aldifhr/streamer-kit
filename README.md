# StreamKit

TikTok Live overlay untuk OBS. Monorepo: Next.js frontend + FastAPI backend
yang menjembatani ke [TikTokLive](https://isaackogan.github.io/TikTokLive/).

> Unofficial. Project ini membaca websocket publik yang juga dibaca viewer mana
> pun; tidak ada login, kredensial, atau API resmi yang dipakai.

## Fitur

- **Overlay chat** — comment, like, gift, join, dan share, real-time via WebSocket
- **Tanpa bot** — cukup `@username` streamer, tidak ada akun yang perlu dihubungkan
- **Editor split** — kustomizer di kiri, live preview di kanan
- **WYSIWYG preview** — canvas di-render pada pixel asli (1080p/720p/vertikal) lalu
  diskalakan, jadi yang terlihat sama dengan hasil di OBS
- **13 widget** — chat, alerts, astronaut, viewers, goal, text, streaks, top gifts,
  milestone, session stats, poll, donation jar, social links
- **6 tema** + kontrol penuh untuk font, warna, spacing, dan event card
- **CSS API** — konfigurasi visual diekspos sebagai custom property `--sk-*`
- **Satu URL per overlay** — beberapa stream bisa jalan bersamaan
- **Auto-reconnect** — overlay bangkit sendiri saat backend restart
- **Password gate** — dashboard dan proxy API butuh login, overlay tidak

## Struktur

```
streamer-kit/
├── apps/
│   ├── web/                  # Next.js 16 + Tailwind
│   │   ├── app/
│   │   │   ├── page.tsx              # Landing
│   │   │   ├── login/                # Password gate
│   │   │   ├── dashboard/            # Daftar overlay
│   │   │   ├── overlays/[id]/        # Editor (kiri customizer, kanan preview)
│   │   │   ├── overlay/[id]/         # Overlay murni untuk OBS (publik)
│   │   │   └── api/                  # Proxy + session (server-only)
│   │   ├── lib/
│   │   │   ├── scene.ts              # Tema + schema config
│   │   │   ├── widgets/              # Registry + 13 widget
│   │   │   ├── session.ts            # HMAC session (WebCrypto, Edge-safe)
│   │   │   └── safe-css.ts           # Sanitizer untuk customCSS
│   │   └── middleware.ts             # Proteksi halaman
│   └── api/                  # FastAPI + TikTokLive (Python 3.12)
│       ├── main.py
│       ├── store.py                 # JSON atomic + lock
│       ├── polls.py                 # Poll, in-memory
│       └── config/                  # overlays.json = runtime state (git-ignored)
└── package.json              # npm workspaces
```

## Menjalankan

Butuh dua terminal. Python **3.12** — 3.14 belum kompatibel dengan TikTokLive.

```bash
npm install                                # dependency web
python3.12 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -r apps/api/requirements.txt
```

```bash
npm run dev:api                            # FastAPI  -> http://localhost:8000
npm run                                    # Next.js  -> http://localhost:3000
```

`npm run dev:api` sudah auto-reload (`uvicorn --reload`). Tanpa env sama sekali
seluruh API terbuka — itu default supaya fresh clone langsung jalan, dan bukan
pilihan untuk deployment. Lihat [Auth](#auth).

## Penggunaan

1. Buka `http://localhost:3000/dashboard`
2. **New** → beri nama overlay
3. **Open** → isi channel TikTok, lalu pilih tema dan atur tampilan
4. **Save settings**
5. Salin **Overlay URL for OBS**, paste ke Browser Source

Overlay荤片 `/overlay/{id}` adalah halaman yang di-load OBS, dan dia **memiliki**
koneksinya sendiri — jadi URL itu langsung jalan begitu di-paste, tanpa perlu
menyalakan apa pun di dashboard.

Di editor, koneksi juga otomatis: begitu channel diisi dan field-nya blur, backend
suruh konek. Tombol **Reconnect** cuma untuk kalau perlu paksa.

## OBS

1. Tambah **Browser Source**
2. Paste `https://<frontend>/overlay/{id}`
3. Set ukuran sesuai canvas (1920×1080, atau 1080×1920 untuk vertikal)
4. Centang **Shutdown source when not visible**

Browser Source tidak bisa login, jadi `/overlay/{id}` **tidak** di-gate. Lihat
[Auth](#auth) untuk konsekuensinya.

## Auth

Dua lapis, dan keduanya wajib untuk deployment.

**Lapisan 1 — proxy frontend.** Dashboard dan `/api/*` butuh session cookie.
`STREAMKIT_API_TOKEN` hanya dibaca di server dan tidak pernah masuk browser
bundle. Kalau `STREAMKIT_PASSWORD` belum di-set, proxy **fail closed dengan
503** — bukan terbuka. Ini disengaja: deploy yang lupa env var akan terlihat
terlindungi di semua respect lain, padahal sama sekali terbuka.

**Lapisan 2 — token backend.** Semua write di backend butuh header
`X-StreamKit-Token` yang cocok dengan `STREAMKIT_TOKEN`. Guard-nya cek method,
bukan daftar path, jadi route mutating baru aman sejak hari pertama ada.

Read, WebSocket, dan `/overlay/*` tetap terbuka — OBS butuh keduanya dan tidak
bisa membawa kredensial.

**Exception yang disengaja:** vote poll pakai `GET`, bukan `POST`. Browser
source tidak bisa membawa session, jadi vote yang butuh session tidak akan pernah
sampai dari stream. Konsekuensinya siapa pun yang bisa load overlay bisa vote,
termasuk bot. Ditulis di `polls.py`.

### Env

| Nama | Tempat | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | FE | Origin backend untuk WebSocket. Wajib `NEXT_PUBLIC_` — Next tidak memproxy upgrade WS, jadi browser harus buka socket sendiri. Ini hostname, bukan kredensial. |
| `STREAMKIT_API_TOKEN` | FE, server-only | Harus sama dengan `STREAMKIT_TOKEN` di backend. **Jangan** pakai prefix `NEXT_PUBLIC_`. |
| `STREAMKIT_PASSWORD` | FE, server-only | Password dashboard. Kosong = proxy 503. |
| `STREAMKIT_SESSION_SECRET` | FE, server-only | Kunci HMAC session. |
| `STREAMKIT_TOKEN` | Backend | Token write. Kosong = backend terbuka. |

## Widget

Tiga belas widget, diatur di editor. Semuanya kecuali poll adalah read-only.

| Widget | Sumber | Catatan |
|---|---|---|
| `chat` | `comment` | List chat, dengan bubble |
| `alerts` | `alert` | Event card untuk gift/follow/share |
| `astro` | `join`, `comment`, `viewers`, … | Astronaut; roster mengikuti room |
| `viewers` | `viewers` | Count saat ini |
| `goal` | satu sumber | Bar untuk gift **atau** follow **atau** like |
| `text` | — | Teks statis |
| `streaks` | `comment` | 🔥 siapa yang nge-chat beruntun |
| `top-gifts` | `gift` | Leaderboard diamond sesi ini |
| `marathon` | semua | Counter yang merayakan tiap N |
| `session-stats` | `viewers` | Durasi + **peak** viewer |
| `poll` | API | Tombol vote, hasil setelah memilih |
| `donation-jar` | 5 sumber | Satu pot, diisi semuanya |
| `social` | — | Handle statis |

### Astronaut

`join` membuat astronot bisu (tanpa bubble atau XP); interaksi yang menambah XP.
Karena TikTok tidak mengirim siapa yang keluar, satu-satunya sinyal leave adalah
penurunan `total_user`, jadi astronot paling lama tidak aktif di-retire saat itu
terjadi. Ambang retirement relatif terhadap roster (`max(2, ceil(roster × 0.1))`),
**bukan** 2% dari total viewer — pada 5000 viewer dengan roster 45, angka lama
butuh 102 orang hilang, yang tidak akan pernah terjadi di stream normal.

XP bertahan setelah astronot dikeluarkan dari Map maupun di-evict karena roster
penuh: `astros` Map adalah siapa yang terlihat, `store` adalah progresi.

## API

Semua write butuh `X-StreamKit-Token`. Semua response JSON.

| Method | Endpoint | Auth | Keterangan |
|---|---|---|---|
| `GET` | `/api/overlays` | — | Daftar overlay |
| `POST` | `/api/overlays` | token | Buat overlay (butuh `name`) |
| `GET` | `/api/overlays/{id}` | — | Detail satu overlay |
| `PATCH` | `/api/overlays/{id}` | token | Ubah `name` / `username` |
| `DELETE` | `/api/overlays/{id}` | token | Hapus overlay |
| `POST` | `/api/overlays/{id}/config` | token | Simpan config |
| `GET` | `/api/overlays/{id}/status` | — | Status koneksi |
| `POST` | `/api/connect` | token | Sambungkan ke room |
| `POST` | `/api/disconnect` | token | Putuskan |
| `POST` | `/api/overlays/{id}/trigger` | token | Trigger manual (test gift) |
| `POST` | `/api/hooks/{id}` | token | Webhook untuk integrasi luar |
| `GET` | `/api/polls/{id}` | — | Baca poll |
| `GET` | `/api/polls/{id}/vote` | — | Vote (`?choice=N`) |
| `POST` | `/api/polls/{id}` | token | Buat/ganti poll |
| `DELETE` | `/api/polls/{id}` | token | Hapus poll |
| `WS` | `/ws/{client_type}/{id}` | — | Stream event |

`POST /api/connect` idempoten per `(overlay, username)` — editor, iframe preview,
dan halaman OBS boleh request connect tanpa saling memutus.

### Event yang di-broadcast

`comment` · `like` · `gift` · `join` · `viewers` · `share` · `alert` · `config` ·
`status` · `error`

`alert` membawa `amount` hanya kalau ada, sehingga alert biasa tidak berubah di
wire. Ini satu-satunya pembawa nilai donasi, dan dulu jumlah itu dibuang dua kali
di `webhook()` dan `_alert()` — jadi angka tiba sebagai label `"50000"` dan tidak
ada sebagai nilai di mana pun.

## Custom CSS

Konfigurasi visual diekspos sebagai CSS custom property, jadi custom CSS bisa
menimpa semua tanpa tahu struktur internal:

```css
:root {
  --sk-font-size: 18px;
  --sk-chat-gap: 8px;
  --sk-event-radius: 0px;
}
```

Class widget yang tersedia: `.sk-root`, `.sk-list`, `.sk-chat`, `.sk-username`,
`.sk-text`, `.sk-event`, `.sk-chip`, `.sk-goal`, `.sk-streaks`, `.sk-gifts`,
`.sk-marathon`, `.sk-stats`, `.sk-poll`, `.sk-jar`, `.sk-social`.

`customCSS` disanitasi oleh `lib/safe-css.ts` sebelum masuk ke
`dangerouslySetInnerHTML` — `</style>` di-close sendiri. Tanpa itu, siapa pun
yang bisa menulis config bisa menyuntik `<script>` ke halaman yang load overlay.

## Deployment

**Backend di VPS, frontend di Vercel.**

Backend: systemd unit dengan `EnvironmentFile=/etc/streamkit/env` (mode `600`), di
belakang nginx dengan TLS dan WebSocket upgrade. `Restart=always`.

Vercel: set kelima env di tabel Auth, lalu deploy. `NEXT_PUBLIC_*` dan
`STREAMKIT_API_TOKEN` dibaca **saat build**, jadi rotasi token butuh redeploy,
bukan restart.

`STREAMKIT_API_TOKEN` tidak boleh punya prefix `NEXT_PUBLIC_` — kalau punya,
nilainya di-inline ke bundle dan siapa pun yang load halaman bisa membacanya.

## Test

```bash
# backend — dari repo root
cd apps/api
.venv/bin/python test_store.py       # atomic replace, lock, recovery
.venv/bin/python test_api.py         # route + auth
STREAMKIT_TOKEN=x TEST_TOKEN=x .venv/bin/python test_polls.py   # poll + vote

# frontend — dari repo root
npm run typecheck                    # tsc --noEmit
npm run test:registry                # setiap widget punya id unik & defaults
npm run test:astro                   # roster astronaut
npm run build && node apps/web/tests/api-gate.cjs   # gerbang auth (butuh build)
```

`test:astro` dan `test:registry` meng-compile engine-nya sendiri lewat tsconfig
khusus, jadi tidak butuh `tsc --noEmit` lebih dulu.

`api-gate.cjs` menjalankan Next server sungguhan di atas HTTP, jadi build harus
up to date. Tiap suite mengambil port bebas dari OS, dan teardown-nya kill process
group lalu menyapu berdasarkan port — bukan port tetap, karena server dari run
sebelumnya akan menjawab dan test-nya diam-diam menguji build yang salah.

`test_api.py` dijalankan dengan `STREAMKIT_TOKEN` **tidak** ter-set; dengan token
aktif ia menolak create-nya sendiri.

## Catatan

- Rate event tidak seragam. `comment`/`like`/`viewers` datang rutin, sedangkan
  event langka (share, sub, gift besar) hanya muncul saat memang terjadi — jangan
  dipakai sebagai sumber kebenaran.
- Placeholder nickname (`Not found`, `?`) difilter di backend, karena TikTok
  mengirimnya untuk profil yang sudah dihapus.
- `JoinEvent` dikirim batch, bukan per-viewer, dan tidak ada leave event.
- `WebcastRoomUserSeqMessage` tidak punya daftar viewer — tidak ada cara tahu siapa
  yang keluar, hanya berapa.
- Widget memakai CSS yang harus didukung browser di OBS. `color-mix()` sengaja
  tidak dipakai (butuh Chromium 111); bar translucent pakai `opacity` di elemen
  anak, dan highlight pakai `inset shadow`.

## Lisensi

MIT
