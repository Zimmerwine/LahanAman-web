# Laporan Audit Dataset SPK LahanAman

Tanggal audit: 13 November 2026  
Lingkup: dataset GeoJSON di `public/data/` yang dipakai atau dipertimbangkan untuk integrasi SPK  
Metode: pembacaan atribut, geometri, CRS, validitas, luas, tumpang tindih, dan penelusuran provenance dari skrip pipeline

## 1. Ringkasan Temuan

1. Dataset guna lahan tersedia dan cukup lengkap untuk analisis informasi, tetapi hanya mencakup Kab. Sleman, Kab. Bantul, dan Kota Yogyakarta. Dataset ini tidak mencakup seluruh DIY.
2. Belum ada dataset resmi RTRW/RDTR, kawasan lindung, zona budaya resmi, atau sempadan sungai. Pembatas legal harus tetap berstatus `NOT EVALUATED`.
3. Kelas `Hutan Lindung`, `Hutan Konservasi`, `Hutan Produksi`, dan `Candi Prambanan` adalah label tutupan/guna lahan, bukan bukti batas atau status kawasan resmi.
4. Metadata sumber belum lengkap: institusi, URL, tanggal publikasi, versi, dan lisensi tidak tercatat. Tidak ada dasar untuk mengklaim verifikasi resmi.
5. Dataset guna lahan dapat dipakai untuk distribusi dan indikasi objek sensitif, tetapi tidak boleh dipakai untuk menyimpulkan kelayakan legal atau menyatakan area bebas pembatas.
6. Geometri bermasalah ditemukan pada beberapa dataset: `clean_batas_administrasi` memiliki 46 geometri tidak valid, `clean_kerawanan_longsor` memiliki 11 geometri tidak valid dan 6 `GeometryCollection`.

## 2. Dataset Guna Lahan Utama

Berkas: `public/data/clean_tutupan_lahan_diy.geojson`

| Item | Nilai |
|---|---|
| Jumlah fitur | 6.393 |
| CRS | `urn:ogc:def:crs:OGC:1.3:CRS84` |
| Polygon | 6.366 |
| MultiPolygon | 26 |
| LineString | 1 |
| Geometri tidak valid | 0 |
| Geometri kosong | 0 |
| Duplikat terdeteksi | 0 |
| Jumlah luas fitur | 112.272,18 ha |
| Luas union | 112.168,47 ha |
| Luas tumpang tindih | 103,71 ha |
| Bounding box | `[110.20372, -8.02784, 110.54669, -7.5419]` |

Atribut: `kabupaten`, `pl`, `klasifikasi`, `skor_lahan`, `skor`, `ket_lahan`, `cr_kpa`, `q_kpa`, `warna_hex`, `luas_ha`.

### Sebaran kelas `pl`

| Kelas | Fitur | Luas (ha) |
|---|---:|---:|
| Permukiman | 2.162 | 42.004,85 |
| Kebun | 1.638 | 16.544,30 |
| Sawah Irigasi | 1.126 | 36.715,47 |
| Tegalan/Ladang | 716 | 8.550,69 |
| Sawah Tadah Hujan | 247 | 1.880,50 |
| Semak/Belukar | 132 | 599,36 |
| Rumput/Tanah Kosong | 90 | 823,72 |
| Emplasemen | 85 | 89,15 |
| Kolam Air Tawar | 56 | 39,51 |
| Sungai | 41 | 1.512,15 |
| Lapangan Olah Raga | 29 | 89,33 |
| Industri | 18 | 19,90 |
| Hutan Lindung | 13 | 1.003,43 |
| Danau/Waduk | 11 | 8,47 |
| Makam | 11 | 2,80 |
| Tambak | 11 | 8,75 |
| Bandara | 2 | 258,53 |
| Candi Prambanan | 2 | 32,61 |
| Hutan Konservasi | 2 | 2.088,61 |
| Hutan Produksi | 1 | 0,03 |

### Sebaran kabupaten/kota

| Wilayah | Fitur | Luas (ha) |
|---|---:|---:|
| Kab. Sleman | 3.943 | 57.781,79 |
| Kab. Bantul | 2.408 | 54.433,07 |
| Kota Yogyakarta | 42 | 57,32 |

Catatan: jumlah luas per kelas dapat melebihi luas cakupan gabungan karena tumpang tindih geometri sumber. API harus melaporkan tumpang tindih dan tidak menjumlahkan kelas secara buta.

## 3. Dataset Guna Lahan Alternatif

Berkas: `public/data/clean_tutupan_lahan_sleman_bantul.geojson`

| Item | Nilai |
|---|---|
| Jumlah fitur | 6.351 |
| Polygon | 6.324 |
| MultiPolygon | 26 |
| LineString | 1 |
| Geometri tidak valid | 0 |
| Geometri kosong | 0 |
| Jumlah luas fitur | 112.214,86 ha |
| Luas union | 112.111,45 ha |
| Tumpang tindih | 103,41 ha |
| Bounding box | `[110.20372, -8.02784, 110.54669, -7.5419]` |

Dataset ini hampir identik dengan dataset utama. Rekomendasi: gunakan satu dataset utama saja untuk analisis agar persentase tidak tercampur. Jangan menggabungkan kedua dataset tanpa aturan deduplikasi.

## 4. Area Jangkauan dan Titik Proyek

### `clean_area_jangkauan_titik.geojson`

- 30 fitur `MultiPolygon`.
- Total luas 2.357,59 ha.
- Sepuluh fitur masing-masing di Kab. Bantul, Kab. Sleman, dan Kota Yogyakarta.
- Atribut `luas_jangkauan_ha` bernilai konstan 78,53 untuk semua fitur; nilai ini tidak konsisten dengan luas geometri aktual dan tidak boleh dipakai sebagai luas resmi.
- Dataset ini adalah area jangkauan proyek, bukan kawasan sensitif dan bukan pembatas legal.

### `clean_titik_developer.geojson`

- 30 fitur `Point`.
- Sebaran di tiga kabupaten/kota.
- Tidak memiliki luas poligon.
- Dataset ini adalah lokasi proyek, bukan data legal atau kawasan sensitif.

## 5. Batas Administrasi

Berkas: `public/data/clean_batas_administrasi.geojson`

- 206 fitur `MultiPolygon`.
- 46 geometri tidak valid; wajib diperbaiki dengan `make_valid` sebelum overlay.
- Total luas geometri sekitar 112.282,19 ha; tumpang tindih sekitar 0,03 ha.
- Mencakup Kab. Sleman (86), Kab. Bantul (75), dan Kota Yogyakarta (45). Tidak mencakup seluruh DIY.
- Atribut mencakup administrasi, elevasi, lereng, hujan, batuan, tanah, tutupan dominan, skor, zona, dan FS.

## 6. Kerawanan Longsor

Berkas: `public/data/clean_kerawanan_longsor.geojson`

| Item | Nilai |
|---|---|
| Jumlah fitur | 915 |
| CRS | `urn:ogc:def:crs:OGC:1.3:CRS84` |
| Polygon | 647 |
| MultiPolygon | 261 |
| GeometryCollection | 6 |
| LineString | 1 |
| Geometri tidak valid | 11 |
| Geometri kosong | 0 |
| Kab. Bantul | 607 |
| Kab. Sleman | 307 |
| Kota Yogyakarta | 1 |

Dataset ini adalah model kerawanan dan atribut skor/FS. Dataset ini bukan penetapan zona rawan longsor resmi dan tidak boleh dipakai untuk klaim legal.

## 7. Provenance dan Keterbatasan

- Pipeline menyebut sumber `GPKG Layer5_Tata Guna Lahan.gpkg` dan overlay batas administrasi BIG.
- `scripts/clean_geojson.py` mendokumentasikan CRS proyek/kerja EPSG:32749.
- `Data/raw` tidak berisi berkas sumber yang dapat diaudit ulang.
- Tidak ada institusi, URL, tanggal publikasi, versi, atau lisensi yang terverifikasi.
- Legenda aplikasi menyebut `RBI 25K`, tetapi label ini belum diverifikasi sebagai metadata resmi.
- Tidak ada dataset RTRW/RDTR, kawasan lindung, zona budaya resmi, atau sempadan sungai.

## 8. Implikasi untuk Integrasi SPK

1. Guna lahan ditampilkan sebagai informasi dan tidak masuk sebagai kriteria WLC baru.
2. Objek/kawasan sensitif ditampilkan sebagai `INDICATION DETECTED`, dengan `binding: false`, `authoritative: false`, dan `legalDesignationVerified: false`.
3. Pembatas legal tetap `NOT EVALUATED` selama dataset resmi belum tersedia.
4. Hasil `NOT DETECTED IN AVAILABLE DATA` tidak boleh diberi warna hijau atau disebut “bebas”.
5. Area di luar cakupan dataset tidak boleh dianggap aman.
6. API dan UI harus menampilkan cakupan, tumpang tindih, sumber lokal, dan peringatan metadata.
7. Perbaiki geometri sebelum overlay dan jangan mengubah berkas dataset asli tanpa persetujuan.
