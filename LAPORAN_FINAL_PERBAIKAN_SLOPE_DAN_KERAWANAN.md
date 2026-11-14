# Laporan Final Audit dan Regenerasi Slope serta Kerawanan LahanAman

**Tanggal:** 14 November 2026
**Mode:** pekerjaan lokal, dataset kandidat saja
**Status rekomendasi:** **LAYAK UNTUK REVIEW TIM**, bukan untuk menggantikan produksi

## 1. Ringkasan eksekutif

Raster slope Day 8 berhasil dibaca dan disampling terhadap 915 geometri GeoJSON produksi. Sampling utama memakai statistik zonal dengan inklusi pusat piksel (`all_touched=False`) dan NoData dikeluarkan. Sebanyak 914 fitur menghasilkan kandidat; satu fitur (FID 824) berupa geometri kosong/non-poligon sehingga tidak diberi nilai slope atau skor sintetis.

Pada 914 fitur dengan nilai, 30 skor lereng berubah dibanding atribut produksi. Dengan bobot, faktor lain, pembulatan dan ambang WLC yang sedang dipakai aplikasi tetap, 8 zona fitur berubah: Hijau 74→72, Kuning 611→617, Merah 230→225. Dampak tersebut adalah simulasi kandidat, bukan perubahan data produksi.

BTL-05 telah dikonfirmasi terhadap geometri benchmark: mean pixel-center 8,040142°, median 8,237951°, 35 piksel pusat valid, coverage sekitar 100%. Kedua nilai tersebut berada di atas 8° (median juga), sehingga menurut batas operasional 0–8 = skor 1 dan >8–15 = skor 2, skor yang konsisten adalah 2. Nilai benchmark lama menyimpan skor 1; penerapan bobot slope 30% mengubah WLC dari 2,00 menjadi 2,30 dengan faktor lain tetap.

Satuan band raster tidak tercatat pada metadata. Derajat masuk akal dari rentang 0–89,42066 dan nama layer, tetapi belum dibuktikan oleh dokumentasi pembentukan raster. Karena itu **914 hasil berstatus PROVISIONAL dan 1 INSUFFICIENT DATA**; tak ada hasil yang diklaim berkeyakinan tinggi/menengah. Data produksi tidak ditimpa.

## 2. Sumber dan integritas data

### Raster yang digunakan

`Slope_Derajat_UTM.tif` dari layer Day 8 (path bersifat lokal dan diteruskan melalui CLI/environment; tidak menjadi dependensi aplikasi).

| Properti | Hasil audit |
|---|---|
| Driver / band | GTiff, 1 band |
| CRS | EPSG:32749 / UTM zone 49S |
| Dimensi | 9.997 kolom × 10.018 baris |
| Resolusi | 8,281170264 m × 8,281170264 m |
| Tipe / NoData | Float32 / -9999 |
| Extent | X 389.665,27–472.452,13 m; Y 9.087.985,09–9.170.945,85 m |
| Piksel | 100.149.946 total; 100.109.920 valid; 40.026 NoData |
| Cakupan valid | 99,9600% |
| Statistik valid | min 0; max 89,42066; mean 4,85598; simpangan baku populasi 7,28230 |
| Metadata unit | kosong; deskripsi band kosong |
| SHA-256 | `3ca3c21e01ab4f6eb28f749bbdf6f962b09be705afd022d8d75752f107f48e12` |

Histogram disimpan pada ringkasan JSON dengan lebar bin 0,01. Median histogram perkiraan raster adalah 1,835; statistik tersebut merangkum seluruh raster, bukan polygon penelitian.

### Data vektor pembanding

- GeoJSON produksi: `public/data/clean_kerawanan_longsor.geojson` — 915 fitur.
- GeoPackage Day 8: 917 fitur master, dibandingkan secara spasial/atribut sebagai pemeriksaan pembanding; bukan dianggap kebenaran mutlak.
- Benchmark kavling: 54 fitur; tabel `zonal_statistics`: 10 fitur.
- GeoJSON lereng dan DEM aplikasi diperiksa dalam audit pipeline terdahulu, tetapi regenerasi ini memakai raster slope, bukan DEM.

Sumber eksternal dibaca saja. GeoJSON produksi dan GeoPackage sumber/benchmark tidak ditulis ulang oleh regenerasi.

## 3. Metode sampling

### Metode kandidat utama

Untuk setiap geometri, geometri diproyeksikan ke CRS raster; raster window dipotong ke bounds; pusat piksel dipilih menggunakan mask polygon `all_touched=False`; nilai NoData/non-finite dibuang. Mean, median, min, max, standar deviasi dan kuantil dihitung dari sel valid. Batas kelas diterapkan ke mean hasil sampling:

| Skor | Batas operasional |
|---:|---|
| 1 | 0° sampai 8° |
| 2 | >8° sampai 15° |
| 3 | >15° sampai 25° |
| 4 | >25° sampai 35° |
| 5 | >35° |

Tidak ada clipping terhadap skor lama. Untuk kandidat yang lolos coverage tetapi unit belum terverifikasi, skor dan dampak tetap dikeluarkan sebagai analisis provisional agar dapat ditinjau; kualitasnya tidak dinaikkan menjadi validasi final.

Coverage valid dihitung sebagai area irisan valid / luas polygon. Perhitungan eksak irisan piksel digunakan pada fallback dan pemeriksaan diagnostik; metode pixel-center tetap menyimpan hitungan piksel terpilih/valid sendiri. Ambang coverage minimum 80%; fallback area-weighted juga mensyaratkan dukungan efektif minimum 5 piksel. Fitur di bawah ambang atau tanpa poligon tidak mendapat skor kandidat.

### Metode pembanding

- `all_touched=True` untuk mengukur sensitivitas batas.
- Median dan kelas dominan dari nilai raster di zonal.
- Titik representatif, jendela 5×5, dan 9×9 untuk membandingkan metode historis.
- Mean/median area-weighted eksak pada 68 fitur terpilih: seluruh fallback pusat yang membutuhkan pembuktian luas serta sampel sistematis/fitur dekat batas kelas/BTL-05. Tidak dihitung mahal untuk seluruh fitur.

Area-weighted bukan dipilih hanya karena cocok dengan atribut lama: nilai rata-rata zona pixel-center menjadi kandidat konsisten untuk seluruh polygon yang memenuhi syarat, sesuai kebijakan pusat piksel dan reproduksibilitas. Bagi polygon kecil, metode pusat dapat memiliki dukungan rendah; hasil disertai dukungan dan kualitas provisional. Pemeriksaan eksak tambahan membantu mengukur sensitivitas, tetapi belum merupakan pembandingan penuh area-weighted atas semua 915 fitur.

Regenerasi ini merupakan standar sampling yang didefinisikan ulang, bukan klaim mereproduksi persis cara pembuatan data historis karena metode historisnya tidak terdokumentasi memadai.

## 4. Hasil slope produksi

| Ukuran | Produksi lama | Kandidat raster |
|---|---:|---:|
| Fitur | 915 | 915 |
| Nilai slope tersedia | 915 | 914 |
| Mean slope (°) | 14,2869 | 14,6185 |
| Median slope (°) | 12,06 | 11,5226 |
| Minimum–maksimum (°) | 0,84–47,51 | 1,6833–42,7525 |
| Skor berubah | — | 30 fitur |
| Sampling tidak memadai/tidak berupa poligon | — | 1 fitur |

Distribusi skor kandidat untuk 914 fitur: skor 1 = 278, skor 2 = 258, skor 3 = 213, skor 4 = 125, skor 5 = 40. Distribusi skor lama 915 fitur: 1 = 279, 2 = 255, 3 = 207, 4 = 128, 5 = 46. Angka ini tidak memasukkan skor pengganti untuk FID 824.

Metode pixel-center utama berhasil melewati ambang pada 905 fitur. Untuk fitur lain, fallback area-weighted atau pemeriksaan diagnostik menghasilkan kandidat provisional; satu geometri kosong tetap gagal. Seluruh rincian per fitur dan alasan kegagalan ada di CSV coverage dan failed-features.

## 5. Validasi BTL-05

| Ukuran | Nilai |
|---|---:|
| `beta_mean` benchmark lama | 8,040142° |
| Mean pixel-center raster | 8,040142° |
| Mean area-weighted raster | 8,038986° |
| Median raster | 8,237951° |
| Min–maks raster | 5,352575–10,465613° |
| Piksel pusat valid | 35 / 35 |
| Piksel beririsan valid (diagnostik area-weighted) | 53 |
| Coverage valid area | ≈100% |
| Skor tersimpan | 1 |
| Skor dari batas operasional pada mean | 2 |
| WLC lama dihitung ulang, faktor lain sama | 2,00 |
| WLC dengan skor lereng 2 | 2,30 |

Benchmark `zonal_statistics` pada sampel yang berpadanan menunjukkan angka sama hingga toleransi numerik pada sepuluh fitur. BTL-05 bukan bukti tunggal bahwa seluruh fitur menggunakan proses identik; perbedaan tetap dapat dipengaruhi geometri benchmark, seleksi piksel, raster yang dipakai, dan aturan batas klasifikasi. Dalam kasus ini geometri benchmark memiliki coverage penuh dan rerata baru sangat dekat dengan `beta_mean`; anomali yang terkonfirmasi adalah skor tersimpan tidak sesuai batas klasifikasi yang dinyatakan.

## 6. Dampak WLC dan zona

Formula dan ambang dari implementasi operasional yang diperiksa dipertahankan; hanya skor lereng diganti. Untuk 914 fitur yang punya kandidat:

| Zona | Produksi | Kandidat | Selisih |
|---|---:|---:|---:|
| Hijau | 74 | 72 | -2 |
| Kuning | 611 | 617 | +6 |
| Merah | 230 | 225 | -5 |

Delapan fitur berpindah zona. Distribusi jumlah fitur berdasarkan WLC kandidat adalah 72 Hijau, 617 Kuning, 225 Merah; satu fitur yang tidak tersampel tidak diberi kelas kandidat. Selisih WLC kandidat terhadap WLC lama yang dihitung ulang dengan faktor lain tetap: median 0; rentang -0,60 sampai +0,60; rata-rata -0,00492. Luas zona kandidat yang dihitung pada ringkasan memakai atribut luas yang sudah ada, bukan hasil overlay luas polygon baru; gunakan jumlah fitur untuk perbandingan utama sampai luas dihitung ulang secara geodesik/proyeksi yang disepakati.

Terdapat 0 konflik antara zona produksi tersimpan dengan WLC lama yang dihitung ulang pada 915 fitur, namun benchmark subset memiliki konflik tersimpan vs hitung ulang. Ini alasan untuk tidak menganggap atribut benchmark atau zona Day 8 sebagai kebenaran tunggal.

### FS / Infinite Slope

Kode menghasilkan simulasi sensitivitas FS pada 914 fitur ketika atribut parameter yang diperlukan tersedia: 669 nilai FS berubah; 34 status ambang berubah; perubahan FS rata-rata -0,03825, median 0, rentang -1,93 hingga +2,75. **Angka ini bukan FS tervalidasi.** Perhitungan memakai parameter fisik tersimpan tanpa validasi mandiri terhadap uji lapangan, muka air, DEM elevasi, atau asal parameter lainnya. Tidak ada klaim bahwa raster slope ini membangun ulang DEM. Nilai tersebut hanya diagnostik sensitivitas terhadap slope input dan harus ditinjau geoteknik; kesimpulan SPK/kelayakan final tetap memerlukan data tersebut.

## 7. Audit dan tampilan zona Merah

GeoJSON produksi memuat 915 fitur, 230 berlabel Merah. Audit geometri menemukan 904 geometri valid dan 11 invalid; 2 dapat diperbaiki, 12 hasil komponen poligon diekstrak dari geometri campuran/koleksi, dan satu fitur Merah bertipe LineString tetap dipertahankan sebagai garis. Salinan display menghasilkan 229 fitur Merah berbentuk poligon dan 1 fitur Merah garis; sumber asli tidak berubah.

Perbaikan membuat layer kerawanan aktif saat halaman dimuat, menjelaskan bahwa angka header adalah jumlah wilayah administrasi, menampilkan jumlah fitur poligon/Merah dari layer, dan memakai `public/data/clean_kerawanan_longsor_display.geojson` sebagai aset display terpisah. GeoJSON sumber tidak diganti. Perubahan geometri hanya untuk rendering, bukan koreksi klasifikasi. Browser smoke test pada 390 px memastikan halaman tidak melebar, layer awal aktif, toggle off/on berhasil, dan tidak muncul error halaman. Screenshot UI tersedia di `outputs/dem-slope-regeneration/zone-red-desktop.png` dan `zone-red-mobile-cdp.png`.

Preview pembandingan lokal kandidat tersedia di `outputs/dem-slope-regeneration/preview_local.html`; preview memisahkan produksi/kandidat, menampilkan metode, unit, coverage, dukungan piksel dan status provisional, serta filter fitur berubah/tidak cukup. Preview dan GeoJSON kandidat lengkap tetap lokal karena GeoJSON berukuran sekitar 41,9 MB dan preview bergantung pada file tersebut.

## 8. Perubahan kode dan file keluaran

Perubahan kerja mencakup (sebagian sudah merupakan perubahan lokal sebelum tugas ini; semuanya dipertahankan):

- `scripts/slope_regeneration.py` — sampling, diagnostik metode, pembandingan dan dataset kandidat.
- `scripts/prepare_kerawanan_display.py` — pembuatan geometri display terpisah.
- Regenerasi slope menerima sumber melalui `--raster`, `--master-gpkg`, `--benchmark-gpkg`, `--production-geojson`, atau variabel lingkungan `LAHANAMAN_SLOPE_RASTER`, `LAHANAMAN_MASTER_GPKG`, `LAHANAMAN_BENCHMARK_GPKG`, `LAHANAMAN_PRODUCTION_GEOJSON`; path lokal tidak menjadi ketergantungan aplikasi.
- `Web/app.js`, `Web/index.html`, `public/data/clean_kerawanan_longsor_display.geojson` — layer Merah dan aset display yang terpisah dari sumber.
- `scripts/slope_classification.py`, `scripts/build_pipeline_from_raw.py`, `scripts/pipeline_data.py`, `scripts/spatial_loader.py` — konsistensi batas klasifikasi/pipeline yang sudah ada pada perubahan lokal.
- Pengujian Python/Node terkait sampling, klasifikasi, tampilan dan SPK.

Artefak utama di `outputs/dem-slope-regeneration/`:

- `slope_regenerated_candidate.geojson`
- `slope_regenerated_comparison.csv`
- `slope_regenerated_summary.json`
- `slope_method_comparison.csv` dan `slope_method_comparison_summary.json`
- `slope_coverage_report.csv`, `slope_failed_features_review.csv`
- `btL05_validation.json`
- `slope_source_config.json`
- `day8_master_to_production_spatial_matches.csv`
- `kerawanan_display.geojson` dan `kerawanan_display_geometry_report.json`
- `public/data/clean_kerawanan_longsor_display.geojson` — aset aplikasi display-only; `vercel.json` menyertakan `public/**`.
- `preview_local.html`, screenshot desktop/mobile

## 9. Pengujian dan pemeriksaan

- `python -m unittest discover -s tests -v`: **30 lulus**.
- `node --test tests/*.test.js`: **43 lulus**.
- `python -m py_compile scripts\slope_regeneration.py scripts\prepare_kerawanan_display.py`: lulus.
- `git diff --check`: lulus.
- Browser smoke test 390 px melalui CDP: lulus; checkbox layer dan hitungan fitur bekerja, halaman tidak overflow horizontal, tanpa page error.
- Tidak mengklaim pengujian browser penuh backend/SPK sebagai tervalidasi geoteknik.

## 10. Batasan, tindak lanjut, dan rekomendasi

1. Konfirmasikan satuan serta algoritme/provenance raster dari pembuat sumber (metadata band kosong). Sampai ada bukti, semua kelas kandidat tetap provisional.
2. Tinjau fitur kecil/dukungan efektif rendah satu per satu; pertimbangkan sampling area-weighted penuh jika waktu dan kebutuhan akurasi membenarkan biaya komputasinya.
3. Tinjau geometri kosong FID 824 dan putuskan sumber geometri yang sah; jangan membuat skor pengganti.
4. Verifikasi parameter dan formula FS dengan ahli geoteknik dan data lapangan sebelum memakai status ambang sebagai kesimpulan.
5. Perbarui zona produksi hanya setelah metodologi, unit, geometri dan benchmark disetujui. Data produksi belum diganti.
6. Layer display memperbaiki visibilitas geometri, bukan kebenaran klasifikasi Merah.

**Rekomendasi akhir: LAYAK UNTUK REVIEW TIM.** Dataset kandidat memiliki metode eksplisit, hasil terukur, sumber dan hash raster, audit per fitur, pemeriksaan benchmark, serta regression test. Dataset belum layak mengganti produksi karena unit raster belum terkonfirmasi dan satu fitur tidak memiliki geometri poligon yang dapat disampling.

## 11. Status Git

Branch tetap `main` dan berada pada `origin/main` saat pemeriksaan. Working tree memuat perubahan lokal yang telah ada sebelum tugas serta file audit/kandidat baru. Tidak dilakukan commit, push, pull, merge, PR, atau deployment.
