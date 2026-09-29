# StreamKit

TikTok Live chat overlay untuk OBS. Monorepo: Next.js frontend + FastAPI backend
yang桥接 ke [TikTokLive](https://isaackogan.github.io/TikTokLive/).

> Unofficial. Project ini reverse-engineers websocket publik yang juga dibaca
> viewer mana pun; tidak ada login, kredensial, atau API resmi yang dipakai.

## Fitur

- **Overlay chat** — comment, like, gift, dan join, real-time via WebSocket
- **Tanpa bot** — cukup `@username` streamer, tidak ada akun yang perlu dihubungkan
- **Editor split** — kustomizer di kiri, live preview di kanan
- **WYSIWYG preview** — canvas di-render pada pixel asli (1080p/720p/vertikal) lalu
  diskalakan, jadi yang terlihat sama dengan hasil di OBS
- **6 tema** + kontrol penuh untuk font, warna, spacing, dan event card
- **CSS API** — seluruh konfigurasi visual diekspos sebagai custom property `--sk-*`
- **Satu URL per overlay** — beberapa stream bisa jalan bersamaan
- **Auto-reconnect** — overlay bangkit sendiri saat backend restart

## Struktur

```
stream-kit/
├── apps/
│   ├── web/                  # Next.js 15 + Tailwind
│   │   ├── app/
│   │   │   ├── page.tsx              # Landing
│   │   │   ├── dashboard/            # Daftar overlay
│   │   │   ├── overlays/[id]/        # Editor (kiri customizer, kanan preview)
│   │   │   └── overlay/[id]/         # Overlay murni untuk OBS
│   │   └── lib/config.ts     # Skema config + generator CSS variable
│   └── api/                  # FastAPI + TikTokLive
│       ├── main.py
│       └── config/           # overlays.json = runtime state (git-ignored)
└── package.json              # npm workspaces
```

## Menjalankan

Butuh dua terminal.

```bash
npm install                      # install dependency web
pip install -r apps/api/requirements.txt
```

```bash
npm run dev:api                  # FastAPI  -> http://localhost:8000
npm run dev                      # Next.js  -> http://localhost:3000
```

`npm run dev:api` sudah auto-reload (`uvicorn --reload`).

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
2. Paste `http://localhost:3000/overlay/{id}`
3. Set ukuran sesuai canvas (1920×1080, atau 1080×1920 untuk vertikal)
4. Centang **Shutdown source when not visible**

## Custom CSS

Config visual diekspos sebagai CSS custom property di `:root`, jadi custom CSS
bisa menimpa semua tanpa tahu struktur internal:

```css
:root {
  --sk-font-size: 18px;
  --sk-chat-gap: 8px;
  --sk-event-radius: 0px;
}
```

Class yang tersedia: `.sk-root`, `.sk-list`, `.sk-chat`, `.sk-username`,
`.sk-text`, `.sk-event`, `.sk-event-icon`, `.sk-event-title`, `.sk-event-value`.

## API

| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/api/overlays` | Daftar overlay |
| `POST` | `/api/overlays` | Buat overlay (hanya butuh `name`) |
| `GET` | `/api/overlays/{id}` | Detail satu overlay |
| `PATCH` | `/api/overlays/{id}` | Ubah `name` / `username` |
| `DELETE` | `/api/overlays/{id}` | Hapus overlay |
| `POST` | `/api/overlays/{id}/config` | Simpan config |
| `POST` | `/api/connect` | Sambungkan ke room |
| `POST` | `/api/disconnect` | Putuskan |
| `WS` | `/ws/{client_type}/{id}` | Stream event |

`POST /api/connect` bersifat idempoten per `(overlay, username)` —editor,
iframe preview, dan halaman OBS boleh/request connect tanpa saling memutus.

### Event yang di-broadcast

`comment` · `like` · `gift` · `join` · `viewers` · `config` · `status` · `error`

`join` dan `viewers` datang dari `JoinEvent`/`RoomUserSeqEvent`; pada stream ramai
`join` bisa ~3× lebih sering dari `comment`, jadi toggle **Joins** dan
**Max events** tersedia di editor.

## Catatan

- Rate event tidak seragam. `comment`/`like`/`viewers` datangrutin, sedangkan
  event langka (share, sub, gift besar) hanya muncul saat memang terjadi — jangan
  dipakai sebagai sumber kebenaran.
- Placeholder nickname (`Not found`, `?`) difilter di backend, karena TikTok
  mengirimnya untuk profil yang sudah dihapus.
- `JoinEvent` dikirim batch, bukan per-viewer.

## Lisensi

MIT
