# Laporan Pekerjaan Redesign UI LahanAman GeoAnalytics DIY

Tanggal: 12 November 2026

Repository: `C:\Users\user\AppData\Local\Temp\opencode\LahanAman-web`

Branch: `redesign/geospatial-spk-ui`

Status pekerjaan: redesign UI selesai dan telah diuji; perubahan belum di-commit.

Alamat lokal: `http://localhost:5000` (HTTP 200)

## 1. Ringkasan Eksekutif

Pekerjaan utama adalah merombak antarmuka WebGIS/SPK LahanAman menjadi dashboard yang lebih rapi, konsisten, responsif, dan mudah digunakan, tanpa mengubah logika analitik yang sudah ada.

Pekerjaan dilakukan pada tiga file produksi:

- `Web/index.html`
- `Web/styles.css`
- `Web/app.js`

Seluruh mesin analitik, bobot parameter, ambang batas, dataset, formula Infinite Slope, dan kontrak API dipertahankan. Pengujian regresi menunjukkan respons API masih identik dengan baseline.

## 2. Temuan Arsitektur Awal

Temuan penting sebelum redesign:

| Temuan | Dampak |
|---|---|
| Aplikasi produksi dilayani oleh Flask melalui `api/index.py` | UI yang harus diubah adalah `Web/index.html`, bukan halaman Next.js |
| `vercel.json` mengarahkan semua route ke `/api/index.py` | Next.js bukan entrypoint produksi |
| Tidak ada `package.json` untuk aplikasi utama | Build frontend tidak diperlukan |
| `app/page.tsx`, `components/*`, `config/layersConfig.ts`, dan `utils/geotechEngine.ts` adalah prototipe legacy | Tidak diubah dan tidak dihapus |
| Dataset berada di `public/data/` | Tidak diubah |
| Logika analitik berada di `Web/app.js` dan API | Harus dipertahankan perilakunya |

## 3. Ruang Lingkup dan Batasan

Pekerjaan mengikuti batasan berikut:

- Tidak mengubah bobot GPKG: Lereng 30%, Tanah 25%, Batuan 20%, Hujan 15%, Lahan 10%.
- Tidak mengubah ambang batas skor, formula FS, parameter tanah, atau klasifikasi zona.
- Tidak mengubah dataset GeoJSON/GPKG.
- Tidak mengubah kontrak `GET /api/query` dan `POST /api/analisis-segmen-kavling`.
- Tidak mengubah transformasi EPSG:32749/EPSG:4326 atau logika point-in-polygon.
- Tidak melakukan push ke `main`.
- Tidak menghapus file legacy.

## 4. Pekerjaan yang Sudah Selesai

### 4.1 Struktur antarmuka (`Web/index.html`)

- Menulis ulang struktur halaman produksi.
- Menambahkan topbar baru:
  - identitas aplikasi dan subjudul;
  - ringkasan zona wilayah (Hijau, Kuning, Merah);
  - indikator CRS;
  - tombol gambar kavling, reset, dan reset view;
  - tombol buka panel wilayah dan panel inspeksi untuk tablet/mobile.
- Menyusun sidebar kiri:
  - filter wilayah berjenjang kabupaten/kota, kapanewon, kalurahan;
  - filter kelas skoring;
  - pencarian wilayah;
  - daftar kalurahan;
  - manajemen layer dengan status toggle, opacity, dan konfigurasi.
- Menyusun toolbar peta:
  - tombol panel layer;
  - gambar poligon;
  - batal gambar;
  - sampel kavling;
  - pemilih basemap.
- Menyusun panel inspeksi kanan:
  - ringkasan keputusan;
  - skor dan zona;
  - stabilitas lereng;
  - audit trail parameter;
  - analisis parameter;
  - interpretasi dan rekomendasi;
  - panel hasil segmentasi kavling.
- Menambahkan bar koordinat WGS84 dan UTM.
- Menambahkan legenda peta yang dapat dibuka/tutup.
- Menambahkan kontrol zoom Leaflet di kanan atas.
- Menambahkan backdrop dan tombol tutup drawer mobile.
- Mengganti ikon eksternal dengan sprite SVG internal.
- Menambahkan favicon SVG inline untuk menghilangkan error 404.
- Menghapus dependency Tailwind CDN.
- Menambahkan atribut aksesibilitas seperti `aria-label`, `title`, `aria-expanded`, dan state disabled.
- Memastikan judul halaman dan meta viewport sesuai.

### 4.2 Sistem desain dan layout (`Web/styles.css`)

- Menyusun design token:
  - warna latar terang, navy, biru aksen;
  - font Inter dan JetBrains Mono;
  - radius, shadow, border, spacing, dan state fokus.
- Membangun layout tiga kolom desktop:
  - sidebar kiri;
  - peta;
  - panel inspeksi kanan.
- Memperbaiki layout tinggi halaman dengan `body` flex column agar peta mengisi viewport dengan benar.
- Menambahkan mode panel kiri dapat diciutkan.
- Menambahkan drawer responsif untuk lebar di bawah 1180px.
- Menyusun breakpoint responsif:
  - 1360px: penyesuaian lebar kolom dan informasi CRS;
  - 1180px: sidebar berubah menjadi drawer;
  - 900px: penyederhanaan topbar dan label;
  - 760px: penyederhanaan brand;
  - 720px: mode mobile penuh;
  - 420px: penyesuaian tombol dan tipografi.
- Memperbaiki overflow topbar pada lebar 360-768px.
- Menata ulang posisi zoom, bar koordinat, skala, dan legenda agar tidak saling bertabrakan.
- Menambahkan styling untuk:
  - kartu ringkasan keputusan;
  - kartu stabilitas lereng;
  - audit grid;
  - daftar parameter;
  - tabel segmen kavling;
  - popup peta;
  - tooltip segmen;
  - empty state;
  - loading state;
  - notifikasi/status;
  - drawer dan backdrop.
- Menghapus seluruh emoji dari antarmuka.

### 4.3 Renderer dan interaksi (`Web/app.js`)

- Menulis ulang seluruh renderer UI agar sesuai struktur HTML baru.
- Menghapus `renderKontrolLayerSidebarKiri()` dan menggantinya dengan `perbaruiJumlahLayerAktif()`.
- Menulis ulang `sinkronTampilanToggleLayer()` untuk:
  - menandai layer aktif;
  - membuka/menutup konfigurasi;
  - memperbarui badge jumlah layer aktif;
  - memperbarui atribut `aria-expanded`.
- Memperbarui pipeline pemuatan data agar memakai renderer baru.
- Menulis ulang:
  - `updateBannerWilayahTerpilih()`;
  - `renderDaftarKalurahanTerfilter()`;
  - `renderEmptyStateSidebar()`;
  - `renderInspektor()`;
  - `buatPopupRingkas()`;
  - `renderLoadingKavlingSidebar()`;
  - tooltip segmen kavling;
  - `renderPanelSegmenKavling()`;
  - `updateLegend()`;
  - `renderSegmenKavlingDiPeta()`;
  - tooltip dan popup peta.
- Menambahkan filter pencarian wilayah pada `#admin-search`.
- Menambahkan state terpilih pada daftar kalurahan.
- Menambahkan reset filter yang juga membersihkan kolom pencarian.
- Menambahkan sinkronisasi dua pemilih basemap melalui `terapkanBasemap()`.
- Menambahkan listener toggle layer dan slider opacity pada struktur baru.
- Menambahkan logika drawer:
  - `layoutMobile()`;
  - `bukaDrawer()`;
  - `tutupDrawer()`;
  - `bukaDrawerInspeksiJikaMobile()`;
  - backdrop;
  - tombol Escape;
  - penyesuaian saat resize.
- Menambahkan perilaku panel kiri desktop yang dapat diciutkan dan dibuka kembali.
- Menambahkan tombol batal gambar dan state tombol gambar.
- Menghapus `map.pm.addControls` ganda.
- Memindahkan zoom Leaflet ke kanan atas.
- Menambahkan pembukaan otomatis drawer inspeksi di mobile setelah analisis titik atau kavling.
- Mempertahankan seluruh fungsi analitik dan perhitungan yang sudah ada.

### 4.4 Perbaikan teknis tambahan

- Memperbaiki favicon 404.
- Menghilangkan konstanta dan referensi layer lama yang sudah tidak dipakai.
- Menghilangkan label opacity duplikat.
- Memisahkan ikon tombol panel wilayah dan panel inspeksi agar mudah dibedakan.
- Menyembunyikan tombol reset view pada lebar mobile untuk mencegah overflow.
- Menyesuaikan label merek pada lebar 760px ke bawah.
- Memastikan peta tetap terlihat dan mengisi ruang setelah drawer ditutup.
- Memastikan legenda dalam keadaan ringkas secara default.

## 5. Fitur Analitik yang Dipertahankan

Fitur berikut tidak diubah secara logika:

- Perhitungan skor GPKG lima parameter.
- Pembobotan lereng, tanah, batuan, hujan, dan tutupan lahan.
- Analisis stabilitas lereng dengan metode Infinite Slope.
- Klasifikasi Zona Hijau, Kuning, dan Merah.
- Filter hierarkis wilayah DIY.
- Filter kelas skoring.
- Deteksi wilayah berdasarkan koordinat.
- Analisis segmentasi kavling.
- Audit trail parameter.
- Rekomendasi struktur dan pondasi.
- Popup dan tooltip informasi wilayah.
- Endpoint API dan format respons.

## 6. Pengujian dan Hasil

### 6.1 Pemeriksaan statis

| Pemeriksaan | Hasil |
|---|---|
| `node --check Web/app.js` | Lulus |
| `python -m py_compile api/index.py` | Lulus |
| `git diff --check` | Lulus, tanpa whitespace error |
| Pemindaian emoji pada `Web/*` | Tidak ditemukan emoji |

### 6.2 Pengujian UI dengan Playwright

Pengujian dilakukan pada Chromium headless dengan viewport desktop, tablet, dan mobile.

| Skenario | Hasil |
|---|---|
| Judul halaman | `LahanAman GeoAnalytics DIY — SPK Kerawanan Longsor` |
| Jumlah item wilayah awal | 40 |
| Empty state panel inspeksi | Tampil |
| Jumlah layer aktif awal | `0 aktif` |
| Setelah toggle layer | `1 aktif` |
| Kelas kartu layer | `layer-item is-active is-open` |
| Slider opacity terlihat | Ya |
| Label opacity setelah diubah | `45%` |
| Sinkronisasi basemap panel ke peta | Berhasil |
| Sinkronisasi basemap peta ke panel | Berhasil |
| Kartu keputusan setelah sampel | 1 |
| Skor | `2,55` |
| Zona | `ZONA KUNING` |
| Wilayah | `Kal. Kepuharjo, Kapanewon Cangkringan, Kab. Sleman` |
| Jumlah parameter | 5 |
| Jumlah sel audit | 8 |
| Pencarian `Umbulharjo` | 8 hasil |
| Badge hasil pencarian | `8 kalurahan` |
| Reset pencarian | Kolom kosong kembali |
| Ringkasan kavling | 1 |
| Baris tabel segmen | 3 |
| Luas kavling | `90.833,2 m2` total; `23.814,0 m2` tercakup |
| Collapse panel kiri desktop | Kelas `workspace is-left-collapsed` |
| Drawer kiri mobile | Terbuka dan terlihat |
| Backdrop mobile | Menutup drawer |
| Drawer inspeksi mobile | Terbuka dan terlihat |
| Inspeksi mobile setelah sampel | Kartu keputusan tampil |
| Error console | Tidak ada |
| Error HTTP 4xx/5xx | Tidak ada setelah favicon diperbaiki |

### 6.3 Pemeriksaan breakpoint

Tidak ditemukan overflow horizontal pada titik uji:

- 360px
- 390px
- 720px
- 721px
- 768px
- 899px
- 900px
- 1024px
- 1180px

Pada 390px dan 360px, `scrollWidth` sama dengan lebar viewport.

### 6.4 Regresi API

Perbandingan dilakukan terhadap baseline sebelum redesign:

| Endpoint | Hasil |
|---|---|
| `GET /api/query?lat=-7.5994&lng=110.4478` | MATCH dengan baseline |
| `POST /api/analisis-segmen-kavling` | MATCH dengan baseline |

Nilai baseline utama tetap sama, termasuk skor akhir 2.55, Zona Kuning, FS 3.17, elevasi 869.14, dan hasil segmentasi kavling.

## 7. Bukti Visual

Screenshot pengujian tersimpan di:

- `C:\Users\user\AppData\Local\Temp\opencode\ui-desktop-initial.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-desktop-inspector.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-desktop-kavling.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-desktop-collapsed.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-mobile-initial.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-mobile-filters.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-mobile-inspector.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-mobile-inspector-populated.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-mobile-360.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-mobile-390.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-tablet-initial.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-721.png`
- `C:\Users\user\AppData\Local\Temp\opencode\ui-768-late.png`

## 8. Status Git

| Item | Status |
|---|---|
| Branch | `redesign/geospatial-spk-ui` |
| HEAD saat laporan dibuat | `73cb603 commit typescript and repairing the maps` |
| File berubah | `Web/app.js`, `Web/index.html`, `Web/styles.css` |
| Dokumen laporan | `LAPORAN_PEKERJAAN.md` (file baru, belum di-commit) |
| Commit perubahan redesign | Belum dilakukan |
| Push ke remote | Belum dilakukan |
| File legacy Next.js | Tidak diubah |
| Dataset dan API | Tidak diubah |

Ringkasan diff:

```text
Web/app.js     |  885 +++++++++-------
Web/index.html |  758 +++++++++-------
Web/styles.css | 3689 +++++++++++++++++++++++++++++++++++++++-----------------
3 files changed, 3504 insertions(+), 1828 deletions(-)
```

## 9. Yang Belum Dikerjakan

- Commit perubahan ke branch `redesign/geospatial-spk-ui`.
- Pembuatan pull request.
- Pengujian lintas browser di Firefox dan WebKit.
- Pengujian di perangkat fisik.
- Audit aksesibilitas formal dengan axe atau Lighthouse.
- Pengujian otomatis yang terintegrasi ke CI.
- UAT dan persetujuan akhir dari pemilik produk.

## 10. Langkah Berikutnya yang Disarankan

1. Review visual dan konten oleh pemilik proyek.
2. Commit perubahan UI ke branch redesign.
3. Buat pull request dengan ringkasan perubahan dan bukti pengujian.
4. Tambahkan pengujian regresi API ke pipeline CI.
5. Lakukan UAT pada desktop, tablet, dan mobile.
6. Lakukan audit aksesibilitas dan performa sebelum merge.

## 11. Cara Menjalankan

```powershell
$env:FLASK_APP = "api/index.py"
python -m flask run --host 127.0.0.1 --port 5000 --no-reload
```

Buka:

```text
http://localhost:5000
```

## 12. Kesimpulan

Redesign UI produksi telah selesai pada tahap implementasi dan pengujian. Antarmuka baru mencakup topbar, sidebar filter, manajemen layer, panel inspeksi, toolbar peta, legenda, bar koordinat, drawer mobile, serta seluruh renderer data analitik.

Hasil pengujian menunjukkan UI berfungsi pada desktop, tablet, dan mobile tanpa error console, tanpa overflow horizontal pada titik uji utama, dan tanpa perubahan hasil analitik. Pekerjaan tersisa adalah review, commit, pull request, serta pengujian lanjutan di lingkungan UAT.

## 13. Addendum Sinkronisasi Upstream

Pada 12 November 2026, perubahan terbaru dari `origin/main` diambil dan diterapkan:

- Commit: `8b12cf3 Repairing logic in web and some points`
- File logika baru yang diterapkan:
  - `utils/geotechCalculator.js`
  - `components/DashboardPage.jsx`
  - `components/MapComponent.jsx`
  - `components/AdminFilterPanel.jsx`
  - `config/layersConfig.js`
  - `scripts/build_pipeline_from_raw.py`
- File legacy TypeScript yang digantikan dihapus sesuai commit upstream.
- Hasil kalkulator baru dibandingkan dengan logika produksi pada data yang sama:
  - skor akhir `2.55`
  - zona `KUNING`
  - FS `3.17`
  - status `STABIL`
  - hasil sama dengan baseline API.
- Dataset hasil regenerasi upstream tidak dipakai karena ditemukan kesalahan atribusi administrasi, contohnya `Kepuharjo, Cangkringan` menjadi `Kabupaten Klaten`, serta beberapa kecamatan/kabupaten tertukar. Dataset `public/data` dan bundle Web dikembalikan ke versi terakhir yang valid.
- Setelah pemulihan dataset:
  - API query kembali MATCH dengan baseline.
  - API analisis kavling kembali MATCH dengan baseline.
  - Pengujian UI Playwright tetap lulus tanpa error console.
- Web Flask tetap berjalan di `http://localhost:5000`.
- Perubahan sinkronisasi upstream belum di-commit.

Dengan demikian, pembaruan logic/kode dari upstream sudah masuk, sedangkan dataset yang terbukti tidak konsisten belum dipaksakan ke aplikasi produksi.

## 14. Addendum Perbaikan Scroll Inspector

Pada 12 November 2026, masalah panel `Decision support / Inspeksi & analisis` yang tidak dapat discroll diperbaiki.

- Penyebab: `.inspector-panel` menggunakan flex column; kartu anak menyusut karena `flex-shrink: 1`, sementara kartu memakai `overflow: hidden`, sehingga konten terpotong dan panel tidak memiliki overflow nyata.
- Perbaikan di `Web/styles.css`: `.inspector-panel > * { flex-shrink: 0; }`.
- Verifikasi:
  - Desktop 1440x900: panel 782/1775 px; wheel down `scrollTop` 0 -> 650.
  - Tablet 1024x768: panel 650/1732 px; wheel down `scrollTop` 0 -> 650.
  - Mobile 390x844: panel 740/1764 px; touch swipe `scrollTop` 0 -> 445.
  - Kavling desktop/mobile/360px: konten muat penuh; tabel tidak overflow horizontal.
  - Playwright penuh lulus tanpa error console.
- Belum di-commit.

## 15. Addendum Sinkronisasi `f78ec30` dan Perbaikan Label Wilayah

Pada 12 November 2026, commit upstream berikut dianalisis dan diterapkan secara selektif ke working tree:

- Commit: `f78ec303f6cedd408fb1bfa0a0c4b2aad870e376` (`fix(vercel): sinkronkan api query backend dan frontend event handler dengan data pipeline geoteknik`).
- File upstream yang berubah: `Web/app.js`, `Web/geojson_bundle.js`, `api/index.py`.
- Keputusan: kode API dan frontend disinkronkan, tetapi bundle/dataset hasil pipeline upstream tidak dipakai karena masih mengandung salah atribusi administrasi, contohnya `Kepuharjo, Cangkringan` terbaca sebagai `Kabupaten Klaten`.

Perbaikan yang diterapkan:

- `api/index.py` memakai layer `admin` sebagai sumber utama `kalurahan`, `kapanewon`, `kabupaten`, dan `elevasi_mdpl`. Label dari `kr_hit` hanya menjadi fallback. Tanpa perbaikan ini, query baseline regres ke `Girikerto, Turi, 610.72 mdpl`.
- `Web/app.js` mempertahankan pembacaan `triase.fsInfo` milik renderer redesign, tetapi juga menerima `triase.fs` dari pipeline f78.
- Skor akhir dibaca dari `skor_internal.skor_akhir` yang benar-benar dikirim API, bukan `bData.triase.skor_akhir` yang tidak ada.
- Label inspeksi tetap mengutamakan data administrasi; handler klik layer kini meneruskan `feature.properties` sesuai perubahan f78, tanpa menimpa label admin dengan label `kr_hit` yang salah.
- Renderer menghitung ulang triase lokal lebih dahulu, lalu menerapkan skor/zona/FS dari API. Ini menjaga kontribusi parameter tetap konsisten dengan skor komponen terbaru.
- `Web/geojson_bundle.js` dan `public/data` tetap memakai versi terakhir yang valid; bundle f78 tidak diterapkan.

Verifikasi setelah sinkronisasi:

- `node --check Web/app.js` dan `python -m py_compile api/index.py` lulus.
- Regresi API baseline: hanya field warna tema yang berubah (`warna_hex`, `border_hex`, `fs_warna_hex`); nilai wilayah, elevasi, skor, zona, FS, luas, dan geometri tetap sama.
- Query baseline: `Kal. Kepuharjo, Kapanewon Cangkringan, Kab. Sleman`, elevasi `869.14 mdpl`, skor `2.55`, zona `KUNING`, FS `3.17`, status `STABIL`.
- Klik layer kerawanan pada koordinat baseline tetap menampilkan `Kepuharjo, Cangkringan, Sleman`; skor `2,55`, FS `3,17`, zona `ZONA KUNING`; tanpa error console.
- `ui_check.js` lulus: region benar, 5 parameter, 8 sel audit, 3 baris kavling, luas `90.833,2 m²` (cakupan `23.814,0 m²`), tanpa error console.
- Scroll inspector tetap berfungsi: desktop 782/1768 px, tablet 650/1726 px, mobile 740/1757 px; wheel/touch `scrollTop` bergerak; tabel kavling muat penuh pada 360/390 px.
- Flask dev server direstart agar `api/index.py` baru termuat.
- Perubahan belum di-commit dan belum di-push.

## 16. Addendum Implementasi SPK Lengkap

Pada 12 November 2026, SPK lengkap ditambahkan di atas WebGIS produksi tanpa mengganti dataset atau mengubah perilaku analisis kavling yang sudah ada.

### 16.1 Cakupan implementasi

- Modul baru:
  - `Web/modules/spk-engine.js` — WLC, profil bobot, agregasi area, klasifikasi, kelengkapan data, dan pemisahan FS.
  - `Web/modules/spatial-constraints.js` — pembatas legal yang belum tersedia, indikator lereng curam, dan indikasi tutupan air.
  - `Web/modules/development-recommendation.js` — enam alternatif pengembangan, gating bukti, dan status rekomendasi.
  - `Web/modules/spk-store.js` — draf, riwayat keputusan lokal, dan ekspor JSON.
  - `Web/modules/spk-ui.js` — drawer konfigurasi/hasil, tab, formulir keputusan, dan perilaku responsif.
- Integrasi WebGIS:
  - Tombol `Analisis SPK` di header dan CTA pada kartu hasil kavling.
  - Badge `SPK aktif`, legenda standar/kustom, pewarnaan ulang segmen, dan fokus segmen dari peta/tabel.
  - Peringatan cakupan rendah yang eksplisit; area tidak tercakup tidak boleh dianggap aman.
- API:
  - `/api/analisis-segmen-kavling` menambahkan `luas_poligon_m2`, `persen_cakupan`, `spk_scores`, `score_completeness`, `data_missing`, dan `spk_actual`.
  - Validasi geometri: hanya `Polygon`/`MultiPolygon` yang tidak kosong dan berarea positif.
  - Tidak mengubah field/baseline lama yang dipakai WebGIS.

### 16.2 Perilaku profil

- Profil standar memakai bobot `30/25/20/15/10`, skor mentah `1–5`, dan ambang `2,20`/`3,40`.
- Profil kustom memakai importance `1–5`, dinormalisasi ke jumlah `1`; ambang zona standar tidak dipakai dan hasil ditandai belum terkalibrasi.
- FS Infinite Slope dihitung/ditampilkan terpisah; perubahan bobot WLC tidak mengubah FS.
- Skor kustom dan standar dibulatkan ke dua desimal sebelum klasifikasi. Perbaikan ini mencegah `3.4000000000000004` salah menjadi Merah; `SEG-03` sekarang Kuning.

### 16.3 Demo dan verifikasi numerik

- Poligon demo: luas `90.833,2 m²`, cakupan `23.814,0 m²` (`26,2%`), 3 segmen.
- Distribusi zona standar: Kuning `7.752,8 m²` (`8,5%`), Merah `16.061,2 m²` (`17,6%`), area tidak tercakup `67.019,2 m²` (`73,8%`).
- Skor standar area-weighted `3,60` (Merah); skor kustom default `3,02` (belum terkalibrasi).
- FS minimum `1,50` (STABIL); FS tetap sama pada kedua profil.
- Segmentasi: `SEG-01` `3,7` Merah FS `1,50`; `SEG-02` `3,7` Merah FS `3,23`; `SEG-03` `3,4` Kuning FS `3,12`.
- Profil standar mereproduksi seluruh 915 nilai `skor_akhir` dan label zona pada data GPKG.

### 16.4 Keputusan pengguna dan batasan

- Status keputusan: `pending`, `accepted`, `accepted_with_conditions`, `rejected`, `needs_more_review`.
- Data disimpan di `localStorage` perangkat (`lahanaman.spk.reviews.v1`, `lahanaman.spk.draft.v1`), dapat diekspor JSON, dan bukan basis data terpusat/keputusan resmi.
- Penyimpanan lokal dapat terkena kuota karena menyimpan snapshot geometri; ekspor JSON tetap diperlukan.
- Dataset RTRW/RDTR, kawasan lindung, dan sempadan sungai belum tersedia; pembatas legal selalu dinyatakan belum dievaluasi.
- Tidak ada skenario yang diprioritaskan saat pembatas legal belum diketahui atau cakupan data belum mencukupi.
- Tidak ada volume cut/fill, dimensi fondasi, atau desain teknis yang dihitung; semua rekomendasi memerlukan peninjauan ahli.

### 16.5 Pengujian

- `node --test tests\spk-engine.test.js tests\spk-constraints-recommendation.test.js`: 14 lulus.
- `node --test tests\spk-store.test.js`: 5 lulus.
- `python -m unittest tests.test_api_spk -v`: 4 lulus.
- `tests/spk_ui_check.js`: standar `3,60`/TERKALIBRASI; kustom `3,02`/BELUM TERKALIBRASI; 6 tab; FS terpisah; FS min `1,50`; 6 skenario; 7 pembatas; RTRW belum dievaluasi; keputusan tersimpan; ekspor terbentuk; mobile 390 px; tanpa error console.
- `ui_check.js` lulus (skor `2,55`, zona Kuning, luas kavling `90.833,2 m²`, tanpa error).
- `label_regression.js` lulus (Kepuharjo, skor `2,55`, FS `3,17`, zona Kuning).
- `scroll_interaction.js` lulus (desktop/tablet/mobile/360 px `docOverflow: 0`, tanpa error).
- `node --check` seluruh modul dan `python -m py_compile api/index.py` lulus.
- Server Flask direstart dan API live memverifikasi geometri `Point` ditolak `400`; query baseline serta respons kavling tetap sesuai baseline.

### 16.6 Status

- Implementasi SPK selesai dan teruji pada working tree.
- Perubahan belum di-commit dan belum di-push.
- Pekerjaan lanjutan yang disarankan: sediakan dataset legal resmi, tambahkan pengujian browser untuk klik segmen peta dan pemulihan draf, serta pertahankan validasi kuota/ekspor untuk keputusan lokal.

## 17. Addendum Integrasi Guna Lahan, Objek Sensitif, dan Pembatas Legal

Pada 13 November 2026, SPK diperluas dengan tiga kelompok informasi spasial yang terpisah tanpa mengubah WLC, FS, segmentasi, atau alur keputusan yang sudah ada.

### 17.1 Dataset dan audit

- Audit dataset ditulis di `LAPORAN_AUDIT_DATASET_SPK.md`.
- Dataset guna lahan utama: `public/data/clean_tutupan_lahan_diy.geojson`, 6.393 fitur, 112.272,18 ha jumlah luas fitur, 112.168,47 ha union, tumpang tindih 103,71 ha.
- Cakupan hanya Kab. Sleman, Kab. Bantul, dan Kota Yogyakarta; tidak seluruh DIY.
- 1 fitur `LineString` tidak diikutkan dalam irisan areal dan dilaporkan sebagai peringatan.
- Dataset area jangkauan dan titik developer bukan data legal/sensitif; `luas_jangkauan_ha` konstan 78,53 tidak dipakai sebagai luas resmi.
- `clean_batas_administrasi.geojson` memiliki 46 geometri tidak valid dan harus diperbaiki dengan `make_valid` sebelum overlay.
- `clean_kerawanan_longsor.geojson` memiliki 915 fitur, 11 geometri tidak valid, dan 6 `GeometryCollection`; dataset ini tetap model, bukan zona resmi.
- Provenance sumber belum lengkap: institusi, URL, tanggal, versi, dan lisensi tidak tercatat. Tidak ada klaim verifikasi resmi.

### 17.2 API

- `api/index.py` memuat cache `land_use` dari dataset guna lahan utama.
- `/api/analisis-segmen-kavling` sekarang mengembalikan:
  - `land_use`: status, metadata sumber, cakupan, luas tercakup/tidak tercakup, tumpang tindih, kelas, fitur irisan, dan peringatan.
  - `sensitive_areas`: indikasi objek/kawasan sensitif, status, kategori, luas, fitur peta, dan peringatan non-legal.
- Perhitungan memakai irisan poligon, union per kelas, union cakupan, dan pelaporan tumpang tindih. Persentase kelas memakai luas poligon sebagai penyebut.
- Jika dataset tidak tersedia, status `not_evaluated`; jika tersedia tetapi tidak ada irisan, status `not_detected` dan tetap diberi peringatan.
- Metadata legal tetap `legalDesignationVerified: false`; tidak ada dataset hukum yang difabrikasi.
- Field respons lama dan baseline demo tidak berubah.

### 17.3 Modul dan UI

- Modul baru:
  - `Web/modules/land-use-information.js`: normalisasi laporan guna lahan, ringkasan, warna, dan format.
  - `Web/modules/sensitive-areas.js`: normalisasi indikasi sensitif dan peringatan non-legal.
- `Web/modules/spatial-constraints.js` memakai status:
  - `RESTRICTED / VERIFIED`
  - `INDICATION DETECTED`
  - `NOT DETECTED IN AVAILABLE DATA`
  - `NOT EVALUATED`
- `NOT DETECTED IN AVAILABLE DATA` memakai tone netral, bukan hijau, karena bukan pembebasan pembatas.
- `Pembatas Spasial` dibagi menjadi:
  - `Penggunaan Lahan di Area yang Dianalisis`
  - `Objek dan Kawasan yang Perlu Diperhatikan`
  - `Verifikasi Aturan dan Pembatas Lahan`
- Ringkasan dinamis ditampilkan di atas ketiga bagian.
- Layer peta baru: `Sebaran guna lahan`, `Objek & kawasan sensitif`, dan `Pembatas legal terverifikasi`.
  - Layer guna lahan dan sensitif aktif setelah analisis kavling dan memiliki toggle independen.
  - Legenda peta mengikuti layer aktif: kelas guna lahan beserta persentase poligon, atau indikasi objek/kawasan sensitif dengan pola garis putus-putus.
  - Layer memakai renderer SVG khusus per pane agar urutan tampilan konsisten dan toggle tidak bertabrakan dengan renderer kanvas utama.
  - Layer legal tetap nonaktif dengan label `Belum tersedia — bukan berarti bebas`.
- Ekspor keputusan menyimpan ringkasan guna lahan/sensitif dan snapshot assessment tanpa geometri fitur untuk mengurangi kuota `localStorage`.

### 17.4 Pengujian

- `node --test tests\spk-engine.test.js tests\spk-constraints-recommendation.test.js tests\spk-store.test.js tests\spk-land-use.test.js`: 26 lulus.
- `python -m unittest tests.test_api_spk -q`: 5 lulus, termasuk uji Candi Prambanan sebagai `INDICATION DETECTED`, bukan status hukum.
- `tests/spk_ui_check.js`: tiga bagian tampil, 3 baris guna lahan, status legal `NOT EVALUATED`, 3 kontrol layer, layer guna lahan dapat ditampilkan/dihilangkan di peta beserta legenda aktif dan pemulihan legenda SPK, ekspor dan mobile lulus, tanpa error console.
- `python -m py_compile api/index.py` dan `node --check` modul terkait lulus.

### 17.5 Status

- Implementasi tiga kelompok informasi selesai pada working tree.
- Perubahan belum di-commit dan belum di-push.
- Verifikasi legal resmi, data RTRW/RDTR, kawasan lindung, zona budaya resmi, dan sempadan sungai tetap menjadi pekerjaan lanjutan yang memerlukan sumber berwenang.
