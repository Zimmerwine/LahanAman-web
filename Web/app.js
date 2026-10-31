/**
 * LahanAman GeoAnalytics DIY — WebGIS Geoteknik & Triase Kelayakan Lahan
 * Standar Koordinat Spasial: EPSG:32749 (WGS 84 / UTM Zone 49S) & EPSG:4326 (WGS 84)
 * Mengacu pada Dokumen Geoteknik DAY 8:
 *   - Kemiringan Lereng (30%), Pedologi/Tanah (15%), Litologi/Batuan (20%), Curah Hujan IDW (20%), Tutupan Lahan (15%)
 *   - Estimasi Faktor Keamanan Lereng Tak Hingga (Terzaghi Infinite Slope FS)
 *   - Semua perhitungan dijalankan secara silent di latar belakang tanpa menampilkan rumus di UI.
 */

(function () {
  "use strict";

  // =========================================================================
  // 1. KONFIGURASI PROYEKSI EPSG:32749 (UTM ZONE 49S) & EPSG:4326 (WGS84)
  // =========================================================================
  const EPSG_32749_DEF = "+proj=utm +zone=49 +south +datum=WGS84 +units=m +no_defs +type=crs";
  if (typeof proj4 !== "undefined") {
    proj4.defs("EPSG:32749", EPSG_32749_DEF);
    proj4.defs("urn:ogc:def:crs:EPSG::32749", EPSG_32749_DEF);
    proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");
  }

  function utm49sToLatLng(coords) {
    const x = Number(coords[0]);
    const y = Number(coords[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return L.latLng(-7.7956, 110.3695);
    }
    if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
      return L.latLng(y, x);
    }
    const [lon, lat] = proj4("EPSG:32749", "EPSG:4326", [x, y]);
    return L.latLng(lat, lon);
  }

  function latLngToUtm49s(latlng) {
    const [x, y] = proj4("EPSG:4326", "EPSG:32749", [latlng.lng, latlng.lat]);
    return { easting: x, northing: y };
  }

  function buatLayerGeoJsonUTM(geojsonData, options) {
    const opts = Object.assign({}, options, {
      coordsToLatLng: utm49sToLatLng,
    });
    return L.geoJSON(geojsonData, opts);
  }

  // =========================================================================
  // 2. INISIALISASI PETA LEAFLET (CLEAN DEFAULT STATE)
  // =========================================================================
  const canvasRenderer = L.canvas({ padding: 0.5, tolerance: 4 });

  const basemaps = {
    google_hybrid: L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      attribution: "&copy; Google Maps Hybrid | Geoteknik DIY EPSG:32749",
    }),
    osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors | Geoteknik DIY EPSG:32749",
      maxZoom: 19,
    }),
    google_sat: L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      attribution: "&copy; Google Maps Satellite | Geoteknik DIY EPSG:32749",
    }),
    google_terrain: L.tileLayer("https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      attribution: "&copy; Google Maps Terrain | Geoteknik DIY EPSG:32749",
    }),
    google_streets: L.tileLayer("https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      attribution: "&copy; Google Maps Streets | Geoteknik DIY EPSG:32749",
    }),
  };

  const map = L.map("map", {
    center: [-7.765, 110.378],
    zoom: 11.25,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    preferCanvas: true,
    renderer: canvasRenderer,
    layers: [basemaps.google_hybrid],
    zoomControl: false,
  });

  L.control.zoom({ position: "topleft" }).addTo(map);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

  // =========================================================================
  // 3. STATE APLIKASI & PALET WARNA GEOTEKNIK DAY 8
  // =========================================================================
  const TRIAGE_HEX = {
    hijau: "#10B981",
    kuning: "#F59E0B",
    merah: "#EF4444",
  };

  const SCORE_COLORS = {
    1: "#10B981",
    2: "#38BDF8",
    3: "#FACC15",
    4: "#F97316",
    5: "#EF4444",
  };

  const SLOPE_COLORS = {
    1: "#1a9850", // 0° – 8° (0% – 14.1%)
    2: "#66bd63", // >8° – 15° (14.1% – 26.8%)
    3: "#facc15", // >15° – 25° (26.8% – 46.6%)
    4: "#f97316", // >25° – 35° (46.6% – 70.0%)
    5: "#ef4444", // >35° (>70.0%)
  };

  const state = {
    filterKab: "ALL",
    filterZona: "ALL",
    polyOpacity: 0.55,
    showAdminOutlines: false,
    selectedFeature: null,
    selectedTriageHex: TRIAGE_HEX.hijau,
    dusunHighlightGroup: L.layerGroup().addTo(map),
    adminFeatures: [],
    devFeatures: [],
    areaDevFeatures: [],
    posFeatures: [],
    idwFeatures: [],
    lerengFeatures: [],
    demnasFeatures: [],
    tutupanFeatures: [],
    layers: {
      admin: null,
      geologi: null,
      tanah: null,
      idwHujan: null,
      lerengPoly: null,
      areaDev: null,
      titikDev: null,
      posHujan: null,
      demnas: null,
      tutupan: null,
    },
    tutupanLoaded: false,
    activeLegendMode: "triase",
  };

  function formatAngka(val, dec = 2) {
    const n = Number(val);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("id-ID", {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  }

  // =========================================================================
  // 4. LOGIKA PENILAIAN GEOTEKNIK & TRIASE DI BALIK LAYAR (ACUAN DAY 8)
  // =========================================================================

  /**
   * 1. Kemiringan Lereng (Bobot 30%):
   *    - Skor 1: 0°–8° (0%–14.1%)
   *    - Skor 2: >8°–15° (14.1%–26.8%)
   *    - Skor 3: >15°–25° (26.8%–46.6%)
   *    - Skor 4: >25°–35° (46.6%–70.0%)
   *    - Skor 5: >35° (>70.0%)
   */
  function evaluasiKemiringanDay8(derajatInput, persenInput) {
    let deg = Number(derajatInput);
    let pct = Number(persenInput);
    if (!Number.isFinite(deg) && Number.isFinite(pct)) {
      deg = Math.atan(pct / 100) * (180 / Math.PI);
    } else if (Number.isFinite(deg) && !Number.isFinite(pct)) {
      pct = Math.tan((deg * Math.PI) / 180) * 100;
    }
    if (!Number.isFinite(deg)) {
      deg = 4.5;
      pct = 7.9;
    }

    let skor = 1;
    let label = "Datar – Landai (0°–8° / 0%–14,1%)";
    if (deg > 35.0 || pct > 70.0) {
      skor = 5;
      label = "Sangat Terjal / Kritis (>35° / >70,0%)";
    } else if (deg > 25.0 || pct > 46.6) {
      skor = 4;
      label = "Curam (>25°–35° / 46,6%–70,0%)";
    } else if (deg > 15.0 || pct > 26.8) {
      skor = 3;
      label = "Agak Curam (>15°–25° / 26,8%–46,6%)";
    } else if (deg > 8.0 || pct > 14.1) {
      skor = 2;
      label = "Landai – Miring (>8°–15° / 14,1%–26,8%)";
    }
    return {
      skor,
      derajat: Number(deg.toFixed(2)),
      persen: Number(pct.toFixed(2)),
      kelas: label,
    };
  }

  /**
   * 2. Karakteristik Tanah Penutup / Pedologi (Bobot 15%):
   *    - Skor 5: Grumosol (c′=9.0 kPa, φ′=15°, ekspansif tinggi)
   *    - Skor 4: Latosol & Mediteran (c′=10–11 kPa, φ′=18°–20°, solum tebal >2m)
   *    - Skor 3: Regosol (c′=3.5 kPa, φ′=36°, pasir lepas/sarang)
   *    - Skor 2: Kambisol (c′=8.0 kPa, φ′=30°)
   *    - Skor 1: Aluvial (c′=14.0 kPa, dataran datar)
   */
  function evaluasiPedologiDay8(jenisTanahRaw) {
    const raw = String(jenisTanahRaw || "Regosol").trim();
    const low = raw.toLowerCase();

    if (
      low.includes("grumosol") ||
      low.includes("grumusol") ||
      low.includes("ekspansif") ||
      low.includes("vertisol") ||
      low.includes("smektit") ||
      low.includes("montmorilonit")
    ) {
      return {
        skor: 5,
        nama: raw.toLowerCase().includes("grum") ? "Grumosol" : raw,
        kategori: "Grumosol (Lempung Ekspansif Tinggi)",
        sifatRingkas:
          "Tanah lempung hitam berplastisitas tinggi (smektit/montmorilonit); kembang-kerut ekstrem (retak saat kering, mengembang saat basah), rentan rayapan lereng dan risiko retak pondasi.",
        cPrime: 9.0,
        phiPrime: 15.0,
        gammaSat: 18.0,
        zDepth: 2.0,
        isExpansive: true,
      };
    }
    if (low.includes("latosol") || low.includes("mediteran") || low.includes("andosol") || low.includes("litosol")) {
      return {
        skor: 4,
        nama: raw,
        kategori: "Latosol & Mediteran (Solum Tebal >2m)",
        sifatRingkas: "Tanah pelapukan lanjut dengan solum tebal (>2 m), plastisitas sedang–tinggi",
        cPrime: 10.0,
        phiPrime: 18.0,
        gammaSat: 18.0,
        zDepth: 2.0,
        isExpansive: false,
      };
    }
    if (low.includes("kambisol") || low.includes("brown forest") || low.includes("inceptisol")) {
      return {
        skor: 2,
        nama: raw,
        kategori: "Kambisol (Tanah Perkembangan Muda)",
        sifatRingkas: "Struktur tanah relatif baik dan daya dukung sedang pada drainase terjaga",
        cPrime: 8.0,
        phiPrime: 30.0,
        gammaSat: 18.0,
        zDepth: 2.0,
        isExpansive: false,
      };
    }
    if (low.startsWith("aluvial") && !low.includes("regosol")) {
      return {
        skor: 1,
        nama: raw,
        kategori: "Aluvial (Endapan Dataran Datar)",
        sifatRingkas: "Endapan lempung-lanau dataran rendah/sungai, topografi datar dengan kohesi cukup",
        cPrime: 14.0,
        phiPrime: 25.0,
        gammaSat: 18.0,
        zDepth: 2.0,
        isExpansive: false,
      };
    }
    // Default / Regosol
    return {
      skor: 3,
      nama: raw,
      kategori: "Regosol (Pasir Vulkanik Lepas / Sarang)",
      sifatRingkas: "Pasir vulkanik lepas/sarang (kohesi rendah), permeabilitas tinggi namun peka gerusan air",
      cPrime: 3.5,
      phiPrime: 36.0,
      gammaSat: 18.0,
      zDepth: 2.0,
      isExpansive: false,
    };
  }

  /**
   * 3. Litologi / Formasi Batuan (Bobot 20%):
   *    - Skor 5: Formasi Semilir (Tmse, Tms3), Sambipitu (Tmss), Nanggulan (Teon), Koluvial/Avalanche (na)
   *    - Skor 4: Formasi Nglanggran (Tmng), Kebobutak (Tomk)
   *    - Skor 3: Formasi Sentolo (Tmps), Merapi Tua (Qmo)
   *    - Skor 2: Endapan Merapi Muda (Qmi, Qvu3)
   *    - Skor 1: Formasi Wonosari (Tmwl), Aluvial (Qa)
   */
  function evaluasiLitologiDay8(formasiRaw, litologiRaw) {
    const raw = String(formasiRaw || "Formasi Gunungapi Merapi Muda (Qmi)").trim();
    const lito = String(litologiRaw || "").trim();
    const primaryClause = raw.split("&")[0].split(",")[0].toLowerCase();
    const fullLow = (raw + " " + lito).toLowerCase();

    if (primaryClause.includes("semilir") || primaryClause.includes("tmse") || primaryClause.includes("tms3")) {
      return {
        skor: 5,
        nama: "Formasi Semilir (Tmse / Tms3)",
        litologi: "Litologi Batuan: Tuf, breksi batuapung (pumice), batupasir tufan & serpih (bidang gelincir aktif)",
        kategori: "Formasi Semilir (Tmse / Tms3) — Batuan Piroklastik & Serpih",
      };
    }
    if (primaryClause.includes("sambipitu") || primaryClause.includes("tmss")) {
      return {
        skor: 5,
        nama: "Formasi Sambipitu (Tmss)",
        litologi: "Litologi Batuan: Perselingan batupasir tufan, serpih & batulanau kedap air",
        kategori: "Formasi Sambipitu (Tmss) — Perselingan Batupasir & Serpih",
      };
    }
    if (primaryClause.includes("nanggulan") || primaryClause.includes("teon")) {
      return {
        skor: 5,
        nama: "Formasi Nanggulan (Teon)",
        litologi: "Litologi Batuan: Batulempung, napal, batupasir kuarsa & sisipan lignit",
        kategori: "Formasi Nanggulan (Teon) — Batulempung & Napal Eosen",
      };
    }
    if (primaryClause.includes("koluvial") || primaryClause.includes("avalanche") || fullLow.includes("(na)")) {
      return {
        skor: 5,
        nama: "Satuan Breksi Piroklastik / Guguran Lava Merapi (na)",
        litologi: "Litologi Batuan: Breksi piroklastik awan panas (ladu) & bongkah lava andesit belum terkonsolidasi",
        kategori: "Satuan Breksi Piroklastik Merapi (na)",
      };
    }
    if (primaryClause.includes("nglanggran") || primaryClause.includes("tmng") || primaryClause.includes("tmn")) {
      return {
        skor: 4,
        nama: "Formasi Nglanggran (Tmng)",
        litologi: "Litologi Batuan: Breksi gunungapi purba, aglomerat & lava andesit-basal berkekar rapat",
        kategori: "Formasi Nglanggran (Tmng) — Breksi Gunungapi Tersier",
      };
    }
    if (primaryClause.includes("kebobutak") || primaryClause.includes("tomk")) {
      return {
        skor: 4,
        nama: "Formasi Kebobutak & Intrusi Diorit (Tomk)",
        litologi: "Litologi Batuan: Breksi andesit, tuf lapili, aglomerat & intrusi batuan beku diorit",
        kategori: "Formasi Kebobutak (Tomk) — Breksi Andesit & Intrusi",
      };
    }
    if (primaryClause.includes("sentolo") || primaryClause.includes("tmps")) {
      return {
        skor: 3,
        nama: "Formasi Sentolo (Tmps)",
        litologi: "Litologi Batuan: Batugamping berlapis, napal tufan & batupasir gampingan",
        kategori: "Formasi Sentolo (Tmps) — Batugamping Berlapis & Napal",
      };
    }
    if (
      fullLow.includes("merapi tua") ||
      fullLow.includes("qmo") ||
      fullLow.includes("turgo") ||
      fullLow.includes("plawangan")
    ) {
      return {
        skor: 3,
        nama: "Formasi Gunungapi Merapi Tua (Qmo)",
        litologi: "Litologi Batuan: Breksi gunungapi tua terkersikkan & aliran lava andesit olivin",
        kategori: "Formasi Gunungapi Merapi Tua (Qmo)",
      };
    }
    if (primaryClause.includes("wonosari") || primaryClause.includes("tmwl") || primaryClause.includes("tmw")) {
      return {
        skor: 1,
        nama: "Formasi Wonosari (Tmwl)",
        litologi: "Litologi Batuan: Batugamping terumbu masif (reef limestone), kalkarenit & batugamping klastik",
        kategori: "Formasi Wonosari (Tmwl) — Batugamping Terumbu Masif",
      };
    }
    if (primaryClause.includes("aluvial") || primaryClause.includes("qa") || primaryClause.includes("klastik")) {
      return {
        skor: 1,
        nama: "Satuan Batuan Klastik Fluvial Kuarter (Qa)",
        litologi: "Litologi Batuan: Konglomerat, kerakal, batupasir klastik kuarter & endapan batuan sedimen dataran",
        kategori: "Satuan Batuan Klastik Fluvial Kuarter (Qa)",
      };
    }

    // Default Skor 2: Formasi Gunungapi Merapi Muda (Qmi, Qvu3)
    return {
      skor: 2,
      nama: "Formasi Gunungapi Merapi Muda (Qmi)",
      litologi: "Litologi Batuan: Breksi laharik, tuf piroklastik, aglomerat & batuan beku lava andesit Merapi Muda",
      kategori: "Formasi Gunungapi Merapi Muda (Qmi / Qvu3)",
    };
  }

  /**
   * 4. Curah Hujan IDW (Bobot 20%):
   *    - Skor 5: >3.000 mm/thn (rasio kejenuhan m = 0.90)
   *    - Skor 4: 2.501–3.000 mm/thn (m = 0.75)
   *    - Skor 3: 2.001–2.500 mm/thn (m = 0.60)
   *    - Skor 2: 1.500–2.000 mm/thn (m = 0.45)
   *    - Skor 1: <1.500 mm/thn (m = 0.30)
   */
  function evaluasiCurahHujanDay8(chMmInput) {
    const ch = Number(chMmInput) || 2250;
    if (ch > 3000) {
      return { skor: 5, chMm: ch, mRatio: 0.90, kelas: "> 3.000 mm/thn (Sangat Tinggi)" };
    }
    if (ch > 2500) {
      return { skor: 4, chMm: ch, mRatio: 0.75, kelas: "2.501 – 3.000 mm/thn (Tinggi)" };
    }
    if (ch > 2000) {
      return { skor: 3, chMm: ch, mRatio: 0.60, kelas: "2.001 – 2.500 mm/thn (Sedang)" };
    }
    if (ch >= 1500) {
      return { skor: 2, chMm: ch, mRatio: 0.45, kelas: "1.500 – 2.000 mm/thn (Rendah–Sedang)" };
    }
    return { skor: 1, chMm: ch, mRatio: 0.30, kelas: "< 1.500 mm/thn (Rendah)" };
  }

  /**
   * 5. Tutupan Lahan (Bobot 15%):
   *    - Skor 5: Lahan terbuka, tegalan, sawah lereng miring
   *    - Skor 4: Semak belukar, rumput
   *    - Skor 3: Permukiman, jaringan jalan
   *    - Skor 2: Perkebunan, kebun campuran
   *    - Skor 1: Hutan lindung, tubuh air
   */
  function evaluasiTutupanLahanDay8(tutupanRaw, lerengDerajat) {
    const raw = String(tutupanRaw || "Permukiman").trim();
    const low = raw.toLowerCase();
    const deg = Number(lerengDerajat) || 4.5;

    if (
      low.includes("terbuka") ||
      low.includes("tegalan") ||
      low.includes("ladang") ||
      (low.includes("sawah") && deg > 8.0)
    ) {
      return {
        skor: 5,
        nama: raw,
        kategori: "Lahan Terbuka / Tegalan / Sawah Lereng Miring",
      };
    }
    if (low.includes("semak") || low.includes("rumput") || low.includes("belukar")) {
      return {
        skor: 4,
        nama: raw,
        kategori: "Semak Belukar & Padang Rumput",
      };
    }
    if (
      low.includes("permukiman") ||
      low.includes("pemukiman") ||
      low.includes("jalan") ||
      low.includes("kota") ||
      low.includes("kegiatan") ||
      low.includes("bandara")
    ) {
      return {
        skor: 3,
        nama: raw,
        kategori: "Permukiman & Jaringan Jalan",
      };
    }
    if (low.includes("perkebunan") || low.includes("kebun") || low.includes("sawah")) {
      return {
        skor: 2,
        nama: raw,
        kategori: low.includes("sawah") ? "Persawahan Dataran Terkelola" : "Perkebunan & Kebun Campuran",
      };
    }
    return {
      skor: 1,
      nama: raw,
      kategori: "Hutan Lindung / Vegetasi Rapat / Tubuh Air",
    };
  }

  /**
   * Estimasi Faktor Keamanan Murni (Factor of Safety / FS Terzaghi Tanpa Manipulasi):
   * FS = [c' + (γ_sat · z - m · γ_w · z) · cos²(β) · tan(φ')] / [γ_sat · z · sin(β) · cos(β)]
   */
  function hitungFsTerzaghiSilent(pedologi, hujan, lerengDerajat) {
    const gammaW = 9.81; // kN/m3
    const gammaSat = 18.0; // kN/m3
    const z = 2.0; // m
    const m = Number(hujan.mRatio) || 0.60;
    const cPrime = Number(pedologi.cPrime) || 8.0;

    // Gunakan sudut kemiringan lereng asli dengan proteksi β_min = 1.0° pada tanah mutlak datar
    const betaEffDeg = Math.max(1.0, Number(lerengDerajat) || 1.0);
    const betaRad = (betaEffDeg * Math.PI) / 180;
    const phiRad = ((Number(pedologi.phiPrime) || 25.0) * Math.PI) / 180;

    const cosB = Math.cos(betaRad);
    const sinB = Math.sin(betaRad);
    const normalEff = (gammaSat * z - m * gammaW * z) * (cosB * cosB);
    const numerator = cPrime + normalEff * Math.tan(phiRad);
    const denominator = gammaSat * z * sinB * cosB;

    const fsRaw = numerator / denominator;
    const fsVal = Number(fsRaw.toFixed(2));

    let status = "Stabil";
    let statusKode = "stabil";
    let keterangan = "Gaya penahan geser tanah melampaui gaya penggerak gravitasi lereng secara aman.";

    if (fsVal < 1.15) {
      status = "Labil";
      statusKode = "labil";
      keterangan = "Gaya penggerak lereng mendekati/melampaui batas kuat geser tanah; bahaya longsor tinggi saat hujan ekstrem.";
    } else if (fsVal < 1.50) {
      status = "Rawan Rayapan";
      statusKode = "rawan";
      keterangan = "Kestabilan lereng marjinal saat tanah jenuh air hujan; rentan rayapan tanah (soil creep) tanpa perkuatan.";
    }

    return {
      fs: fsVal,
      status,
      statusKode,
      keterangan,
    };
  }

  /**
   * Perhitungan Skor Akhir & Nilai Triase Warna DAY 8 (Silent Background):
   * - Zona Hijau (Aman / Risiko Rendah): Skor Akhir < 2.20 atau lereng datar (0°–8°) tanpa lempung ekspansif. Hex: #10B981
   * - Zona Kuning (Waspada / Perlu Mitigasi & RAB): Skor Akhir 2.20 – 3.40. Hex: #F59E0B
   * - Zona Merah (Bahaya Kritis / Non-Buildable): Skor Akhir > 3.40. Hex: #EF4444
   */
  function evaluasiTriaseDay8(lereng, pedologi, litologi, hujan, tutupan) {
    const skorAkhir = Number(
      (
        0.30 * lereng.skor +
        0.15 * pedologi.skor +
        0.20 * litologi.skor +
        0.20 * hujan.skor +
        0.15 * tutupan.skor
      ).toFixed(2)
    );

    const fsInfo = hitungFsTerzaghiSilent(pedologi, hujan, lereng.derajat);

    if (skorAkhir > 3.40) {
      if (fsInfo.fs >= 1.50) {
        if (lereng.derajat <= 8.0) {
          fsInfo.keterangan =
            "Kerawanan makro tinggi akibat faktor geologi/hujan, namun kestabilan lereng lokal stabil mutlak karena topografi datar.";
        } else {
          fsInfo.keterangan =
            "Kestabilan geser lereng lokal terhitung stabil (FS ≥ 1.50), namun tetap berada pada zona waspada/kritis makro akibat faktor formasi geologi/litologi atau tutupan lahan.";
        }
      }
      const isSangatTerjal = lereng.skor >= 5 || lereng.derajat > 35.0;
      return {
        kode: "merah",
        hex: TRIAGE_HEX.merah,
        namaZona: "Zona Merah",
        badge: "ZONA MERAH (BAHAYA KRITIS)",
        ringkasanStatus: isSangatTerjal
          ? "Bahaya Kritis / Non-Buildable — Lereng Sangat Terjal (>35°)"
          : "Zona Kerawanan Geologi Tinggi — Perlu Penyelidikan Geoteknik Rinci",
        skorAkhir,
        fsInfo,
      };
    }

    if (skorAkhir < 2.20 || (lereng.derajat <= 8.0 && !pedologi.isExpansive)) {
      return {
        kode: "hijau",
        hex: TRIAGE_HEX.hijau,
        namaZona: "Zona Hijau",
        badge: "ZONA HIJAU (AMAN)",
        ringkasanStatus: "Aman / Risiko Geoteknik Rendah — Lahan Stabil",
        skorAkhir,
        fsInfo,
      };
    }

    if (fsInfo.fs >= 1.50) {
      if (lereng.derajat <= 8.0) {
        fsInfo.keterangan =
          "Kerawanan makro menengah akibat faktor geologi/tanah/hujan, namun kestabilan lereng lokal stabil mutlak karena topografi datar.";
      } else {
        fsInfo.keterangan =
          "Kestabilan geser lereng lokal terhitung stabil (FS ≥ 1.50), namun tetap berada pada zona waspada/kritis makro akibat faktor formasi geologi/litologi atau tutupan lahan.";
      }
    }

    return {
      kode: "kuning",
      hex: TRIAGE_HEX.kuning,
      namaZona: "Zona Kuning",
      badge: "ZONA KUNING (PERLU MITIGASI)",
      ringkasanStatus: "Waspada / Perlu Rekayasa Mitigasi Fondasi & Drainase",
      skorAkhir,
      fsInfo,
    };
  }

  // =========================================================================
  // 5. GENERATOR REKOMENDASI AHLI BERBASIS AI (AI GEOTECHNICAL ADVISOR)
  // =========================================================================
  function buatRekomendasiAiGeoteknik(info) {
    const deg = info.lereng.derajat;
    const pct = info.lereng.persen;
    const tanah = info.pedologi;
    const batuan = info.litologi;
    const hujan = info.hujan;
    const triase = info.triase;

    // 1. Diagnosa Bahaya Geoteknik
    let diagnosa = "";
    if (triase.kode === "merah" && triase.fsInfo.fs >= 1.50) {
      if (deg <= 8.0) {
        diagnosa = `Kerawanan makro tinggi dipicu oleh faktor geologi (<b>${batuan.nama}</b>), tanah (<b>${tanah.nama}</b>), dan curah hujan <b>${formatAngka(hujan.chMm, 0)} mm/thn</b>, namun kestabilan lereng lokal stabil mutlak (<b>FS ${formatAngka(triase.fsInfo.fs, 2)}</b>) karena topografi datar (<b>${formatAngka(deg, 1)}° / ${formatAngka(pct, 1)}%</b>).`;
      } else {
        diagnosa = `Kestabilan geser lereng lokal pada kemiringan <b>${formatAngka(deg, 1)}° (${formatAngka(pct, 1)}%)</b> terhitung stabil (<b>FS ${formatAngka(triase.fsInfo.fs, 2)}</b>), namun tetap berada pada zona kritis makro akibat faktor formasi geologi (<b>${batuan.nama}</b>), tanah (<b>${tanah.nama}</b>), dan curah hujan (<b>${formatAngka(hujan.chMm, 0)} mm/thn</b>).`;
      }
    } else if (tanah.isExpansive) {
      diagnosa = `Tanah <b>${tanah.nama}</b> (lempung ekspansif tinggi) pada kemiringan <b>${formatAngka(deg, 1)}° (${formatAngka(pct, 1)}%)</b> sangat rentan mengalami kembang-susut ekstrem dan rayapan tanah (<i>soil creep</i>) saat curah hujan <b>${formatAngka(hujan.chMm, 0)} mm/thn</b>; waspadai potensi pengangkatan lantai (<i>heaving</i>) dan retakan struktural dinding.`;
    } else if (deg > 25.0 || triase.kode === "merah") {
      diagnosa = `Kemiringan lereng <b>${formatAngka(deg, 1)}° (${formatAngka(pct, 1)}%)</b> di atas batuan <b>${batuan.nama}</b> dengan tanah <b>${tanah.nama}</b> memiliki tegangan geser gravitasi tinggi. Saat curah hujan mencapai <b>${formatAngka(hujan.chMm, 0)} mm/thn</b>, kejenuhan air pori memicu risiko kelongsoran lereng (<i>slope failure</i>) pada bidang kontak batuan.`;
    } else if (batuan.skor >= 4 && deg > 8.0) {
      diagnosa = `Kombinasi lereng <b>${formatAngka(deg, 1)}° (${formatAngka(pct, 1)}%)</b> dengan batuan <b>${batuan.nama}</b> dan tanah penutup <b>${tanah.nama}</b> berisiko membentuk bidang gelincir lemah pada zona pelapukan batuan saat jenuh air hujan (<b>${formatAngka(hujan.chMm, 0)} mm/thn</b>).`;
    } else if (tanah.skor === 4 && deg > 8.0) {
      diagnosa = `Tanah <b>${tanah.nama}</b> memiliki solum pelapukan tebal (&gt;2 m) pada lereng <b>${formatAngka(deg, 1)}°</b>; berpotensi mengalami penurunan konsolidasi diferensial dan pergerakan lambat (rayapan) apabila drainase permukaan tidak terkontrol.`;
    } else if (tanah.skor === 3 && deg > 8.0) {
      diagnosa = `Tanah <b>${tanah.nama}</b> bersifat berbutir pasir lepas/sarang pada lereng miring <b>${formatAngka(deg, 1)}° (${formatAngka(pct, 1)}%)</b>; sangat peka terhadap erosi buluh (<i>piping</i>), gerusan air limpasan permukaan, dan longsoran dangkal pada tebing galian.`;
    } else {
      diagnosa = `Topografi relatif datar–landai <b>${formatAngka(deg, 1)}° (${formatAngka(pct, 1)}%)</b> dengan tanah <b>${tanah.nama}</b> dan formasi <b>${batuan.nama}</b> menunjukkan stabilitas lereng yang baik (<b>FS ${formatAngka(triase.fsInfo.fs, 2)}</b>). Perhatian utama cukup pada pemadatan tanah dasar (<i>subgrade</i>) dan pengelolaan drainase air hujan (<b>${formatAngka(hujan.chMm, 0)} mm/thn</b>).`;
    }

    // 2. Rekomendasi Struktur & Fondasi
    let fondasi = "";
    if (tanah.isExpansive) {
      fondasi = `Gunakan fondasi tiang <b>Strauss Pile / Bore Pile</b> ($\u00d8 30–40 cm, kedalaman 3–6 m) menembus zona aktif lempung ekspansif hingga lapisan tanah keras, diikat dengan <b>sloof beton bertulang kaku (<i>rigid grade beam</i>)</b> dan bantalan pasir urug non-ekspansif. Hindari fondasi dangkal batu kali langsung di atas lempung Grumosol.`;
    } else if (triase.kode === "merah" || deg > 25.0) {
      fondasi = `Hindari pembangunan hunian konvensional tanpa penyelidikan geoteknik. Wajib uji <b>Sondir (CPT) &amp; Boring SPT</b> serta menggunakan <b>fondasi dalam Bore Pile / Strauss Pile</b> yang ditanam masuk ke lapisan batuan dasar (<i>bedrock socketed</i>) dengan struktur mengikuti kontur.`;
    } else if (deg > 15.0) {
      fondasi = `Gunakan kombinasi <b>fondasi Telapak Beton Bertulang (Footplat)</b> dan <b>tiang Strauss Pile</b> pada sisi bawah lereng untuk mencegah penurunan tak seragam (<i>differential settlement</i>), diperkuat balok pengikat (<i>tie beam</i>) kaku.`;
    } else if (tanah.skor === 4) {
      fondasi = `Gunakan <b>fondasi Footplat beton bertulang</b> atau <b>Strauss Pile</b> kedalaman 2,0–3,5 m menembus solum tanah pelapukan tebal hingga tanah keras; untuk bangunan 1 lantai pastikan pemadatan lapis fondasi bawah menggunakan sirtu padat.`;
    } else if (deg > 8.0) {
      fondasi = `Gunakan <b>fondasi menerus batu kali</b> yang diperkuat <b>Footplat beton bertulang</b> pada kolom utama (kedalaman minimal 1,0–1,2 m) dengan pengupasan tanah pucuk (<i>stripping</i>) dan pemadatan sirtu berlapis.`;
    } else {
      fondasi = `Dapat menggunakan <b>fondasi dangkal menerus pasangan batu kali</b> (bangunan 1 lantai) atau <b>fondasi Footplat beton bertulang</b> (bangunan 2 lantai) pada kedalaman 0,8–1,2 m setelah pengupasan lapisan topsoil sawah/kebun dan pemadatan tanah dasar.`;
    }

    // 3. Rekomendasi Mitigasi & Drainase
    let mitigasi = "";
    if (triase.kode === "merah") {
      mitigasi = `Dilarang melakukan pemotongan tebing tegak (<i>vertical cut</i>). Wajib konstruksi <b>Dinding Penahan Tanah (DPT) Beton Bertulang / Bronjong Kawat</b> berjenjang, saluran drainase pengelak di puncak lereng (<i>interceptor drain</i>), <i>weep hole</i> berlapis geotekstil, serta vegetasi penguat lereng berakar dalam.`;
    } else if (triase.kode === "kuning") {
      mitigasi = `Bangun <b>talud pasangan batu 1:4 atau Retaining Wall</b> pada beda tinggi kontur &gt;1,2 m lengkap dengan suling-suling (<i>weep hole</i> \u00d8 2" berlapis ijuk/geotekstil), saluran drainase U-Ditch kedap air untuk mencegah infiltrasi air limpasan ke bidang lereng, serta penataan kavling sistem <i>cut-and-fill</i> terasering.`;
    } else {
      mitigasi = `Pekerjaan tanah cukup dengan metode <b>cut-and-fill standar</b> dan pemadatan terkontrol per lapis 20 cm, dilengkapi saluran drainase lingkungan (U-Ditch / pasangan batu) dan sumur resapan air hujan sesuai standar teknis kawasan permukiman.`;
    }

    // 4. Status Kelayakan Kavling / KPR
    let statusKpr = "Layak Bangun Langsung";
    let descKpr =
      "Memenuhi syarat teknis pengembangan kavling perumahan dan agunan KPR reguler dengan pekerjaan pematangan lahan standar.";
    if (triase.kode === "kuning") {
      statusKpr = "Layak dengan Syarat Mitigasi Khusus & Anggaran Tambahan";
      descKpr =
        "Dapat dibangun dan dibiayai KPR dengan syarat wajib menyertakan pekerjaan perkuatan fondasi/talud, drainase kedap, dan cadangan RAB mitigasi geoteknik.";
    } else if (triase.kode === "merah") {
      if (info.lereng.skor >= 5 || deg > 35.0) {
        statusKpr = "Zona Sangat Terjal / Non-Buildable";
        descKpr =
          "Tidak direkomendasikan untuk kavling perumahan reguler / pembiayaan KPR (Non-Buildable Zone) karena kemiringan lereng sangat terjal (>35°) dan risiko longsor kritis.";
      } else {
        statusKpr =
          "Zona Kerawanan Geologi Tinggi — Perlu Penyelidikan Geoteknik Rinci (Sondir/Bor) & Perkuatan Lereng.";
        descKpr =
          "Berada pada zona kerawanan geologi/lingkungan tinggi meskipun kemiringan lereng di bawah 35°; pembangunan wajib didahului uji Sondir/Bor geoteknik rinci, rekayasa perkuatan lereng, dan drainase kedap air.";
      }
    }

    return {
      diagnosa,
      fondasi,
      mitigasi,
      statusKpr,
      descKpr,
    };
  }

  // =========================================================================
  // 6. ENGINE GEOMETRI POINT-IN-POLYGON (EPSG:32749) & SPATIAL QUERY
  // =========================================================================
  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = Number(ring[i][0]);
      const yi = Number(ring[i][1]);
      const xj = Number(ring[j][0]);
      const yj = Number(ring[j][1]);
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonCoords(x, y, polyCoords) {
    if (!polyCoords || !polyCoords.length) return false;
    if (!pointInRing(x, y, polyCoords[0])) return false;
    for (let k = 1; k < polyCoords.length; k++) {
      if (pointInRing(x, y, polyCoords[k])) return false;
    }
    return true;
  }

  function pointInGeometry(xUtm, yUtm, lngWgs, latWgs, geom) {
    if (!geom || !geom.coordinates || !geom.coordinates.length) return false;
    // Deteksi apakah koordinat geometri dalam EPSG:4326 (WGS84) atau EPSG:32749 (UTM 49S)
    const sampleCoord =
      geom.type === "Polygon"
        ? geom.coordinates[0] && geom.coordinates[0][0]
        : geom.coordinates[0] && geom.coordinates[0][0] && geom.coordinates[0][0][0];
    const isWgs84 =
      sampleCoord &&
      Math.abs(Number(sampleCoord[0])) <= 180 &&
      Math.abs(Number(sampleCoord[1])) <= 90;
    const tx = isWgs84 ? lngWgs : xUtm;
    const ty = isWgs84 ? latWgs : yUtm;

    if (geom.type === "Polygon") {
      return pointInPolygonCoords(tx, ty, geom.coordinates);
    }
    if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        if (pointInPolygonCoords(tx, ty, poly)) return true;
      }
    }
    return false;
  }

  function cariFiturPoligonPadaTitik(xUtm, yUtm, featureList, lngWgs, latWgs) {
    if (!featureList || !featureList.length) return null;
    let lng = lngWgs;
    let lat = latWgs;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      const ll = utm49sToLatLng([xUtm, yUtm]);
      lat = ll.lat;
      lng = ll.lng;
    }
    for (const feat of featureList) {
      if (pointInGeometry(xUtm, yUtm, lng, lat, feat.geometry)) {
        return feat;
      }
    }
    return null;
  }

  function cariDusunTerdekatLokal(lat, lng, kalurahanHint) {
    const katalog =
      window.LAHAN_AMAN_META && Array.isArray(window.LAHAN_AMAN_META.dusun_diy) && window.LAHAN_AMAN_META.dusun_diy.length
        ? window.LAHAN_AMAN_META.dusun_diy
        : DUSUN_KATALOG_DIY;
    if (!katalog || !katalog.length) return null;

    const kalLow = String(kalurahanHint || "").trim().toLowerCase();
    let bestSameKal = null;
    let minSameKalDist2 = Infinity;
    let bestGlobal = null;
    let minGlobalDist2 = Infinity;

    for (const d of katalog) {
      const dLat = Number(d.lat);
      const dLng = Number(d.lng ?? d.lon);
      if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) continue;
      const d2 = (dLat - lat) * (dLat - lat) + (dLng - lng) * (dLng - lng);
      if (d2 < minGlobalDist2) {
        minGlobalDist2 = d2;
        bestGlobal = d;
      }
      if (kalLow && String(d.kalurahan || "").trim().toLowerCase() === kalLow && d2 < minSameKalDist2) {
        minSameKalDist2 = d2;
        bestSameKal = d;
      }
    }
    // Gunakan Dusun di dalam Kalurahan yang sama bila jaraknya wajar (~3.5 km)
    if (bestSameKal && minSameKalDist2 <= 0.0012) {
      return bestSameKal.nama_dusun || bestSameKal.dusun || null;
    }
    if (bestGlobal) {
      return bestGlobal.nama_dusun || bestGlobal.dusun || null;
    }
    return null;
  }

  function cariKalurahanBerdasarkanUTM(easting, northing, kabupatenHint) {
    const ll = utm49sToLatLng([easting, northing]);
    // 1. Cek Point-in-Polygon eksak terlebih dahulu (mendukung EPSG:4326 maupun EPSG:32749)
    const exactFeat = cariFiturPoligonPadaTitik(easting, northing, state.adminFeatures, ll.lng, ll.lat);
    if (exactFeat) return exactFeat.properties;

    // 2. Fallback ke centroid Kalurahan terdekat
    if (!state.adminFeatures.length) return null;
    let kandidatTerdekat = null;
    let jarakMin = Infinity;

    for (const feat of state.adminFeatures) {
      const p = feat.properties;
      if (kabupatenHint && p.kabupaten && p.kabupaten !== kabupatenHint && !String(kabupatenHint).includes("Lintas")) {
        continue;
      }
      const dx = (Number(p.easting_x) || 0) - easting;
      const dy = (Number(p.northing_y) || 0) - northing;
      const d2 = dx * dx + dy * dy;
      if (d2 < jarakMin) {
        jarakMin = d2;
        kandidatTerdekat = p;
      }
    }
    return kandidatTerdekat;
  }

  /**
   * Ekstraksi Spasial Multi-Layer (Point-in-Polygon ke GeoJSON Day 1–8)
   * Menggabungkan data Kalurahan, Poligon Lereng DEMNAS, Kontur IDW, Tutupan Lahan, & Area Uji
   */
  function analisisSpasialTitik(rawProps, sumberLabel, latlngKlik, dusunOverride) {
    const utmKlik = latlngKlik ? latLngToUtm49s(latlngKlik) : null;
    const easting = Number(utmKlik ? utmKlik.easting : rawProps && rawProps.easting_x) || 435865;
    const northing = Number(utmKlik ? utmKlik.northing : rawProps && rawProps.northing_y) || 9146908;
    const wgsLatLng = latlngKlik || utm49sToLatLng([easting, northing]);

    // Query Point-in-Polygon ke semua layer spasial
    const adminProps = cariKalurahanBerdasarkanUTM(easting, northing, rawProps ? rawProps.kabupaten : null) || {};
    const mergedProps = Object.assign({}, adminProps, rawProps || {});

    const slopePolyFeat = cariFiturPoligonPadaTitik(easting, northing, state.lerengFeatures, wgsLatLng.lng, wgsLatLng.lat);
    const idwPolyFeat = cariFiturPoligonPadaTitik(easting, northing, state.idwFeatures, wgsLatLng.lng, wgsLatLng.lat);
    const geologiPolyFeat = state.geologiFeatures && state.geologiFeatures.length
      ? cariFiturPoligonPadaTitik(easting, northing, state.geologiFeatures, wgsLatLng.lng, wgsLatLng.lat)
      : null;
    const tanahPolyFeat = state.tanahFeatures && state.tanahFeatures.length
      ? cariFiturPoligonPadaTitik(easting, northing, state.tanahFeatures, wgsLatLng.lng, wgsLatLng.lat)
      : null;
    const tutupanPolyFeat = state.tutupanFeatures.length
      ? cariFiturPoligonPadaTitik(easting, northing, state.tutupanFeatures, wgsLatLng.lng, wgsLatLng.lat)
      : null;

    // Gunakan sudut kemiringan lereng asli kontinu hasil ekstraksi piksel DEMNAS (tanpa midpoint override)
    const lerengDerajat =
      mergedProps.lereng_derajat ??
      mergedProps.lereng_area_derajat ??
      adminProps.lereng_derajat;
    const lerengPersen =
      mergedProps.lereng_persen ??
      mergedProps.lereng_area_persen ??
      adminProps.lereng_persen;

    const lereng = evaluasiKemiringanDay8(lerengDerajat, lerengPersen);
    // Skor lereng 1 s.d. 5 dari poligon lereng hanya untuk bobot kerawanan makro, TIDAK menimpa derajat/persen asli
    if (slopePolyFeat && slopePolyFeat.properties) {
      const sPoly = Number(slopePolyFeat.properties.skor || slopePolyFeat.properties.skor_leren || slopePolyFeat.properties.skor_lereng);
      if (sPoly >= 1 && sPoly <= 5) {
        lereng.skor = sPoly;
      }
    }

    // Pedologi / Karakteristik Tanah
    const jenisTanahStr =
      (tanahPolyFeat && tanahPolyFeat.properties && tanahPolyFeat.properties.jns_tnh) ||
      mergedProps.jenis_tanah ||
      adminProps.jenis_tanah ||
      "Regosol Vulkanik";
    const pedologi = evaluasiPedologiDay8(jenisTanahStr);

    // Litologi / Formasi Batuan
    const formasiStr =
      (geologiPolyFeat &&
        geologiPolyFeat.properties &&
        `${geologiPolyFeat.properties.NAME || ""} (${geologiPolyFeat.properties.SYMBOLS || ""})`) ||
      mergedProps.formasi_batuan ||
      adminProps.formasi_batuan ||
      "Formasi Gunungapi Merapi Muda (Qmi)";
    const litologiStr =
      (geologiPolyFeat && geologiPolyFeat.properties && geologiPolyFeat.properties.ket_batuan) ||
      mergedProps.litologi_penyusun ||
      adminProps.litologi_penyusun ||
      "";
    const litologi = evaluasiLitologiDay8(formasiStr, litologiStr);

    // Curah Hujan IDW
    let chIdwMm =
      mergedProps.ch_idw_mm ??
      mergedProps.ch_idw_titik_mm ??
      mergedProps.ch_idw_area_mm ??
      mergedProps.rerata_ch_tahunan ??
      adminProps.ch_idw_mm ??
      2250;
    if (idwPolyFeat && idwPolyFeat.properties && idwPolyFeat.properties.ch_idw_rerata_mm && !mergedProps.ch_idw_mm) {
      chIdwMm = idwPolyFeat.properties.ch_idw_rerata_mm;
    }
    const hujan = evaluasiCurahHujanDay8(chIdwMm);

    // Tutupan Lahan
    const tutupanStr =
      (tutupanPolyFeat && tutupanPolyFeat.properties && tutupanPolyFeat.properties.klasifikasi) ||
      mergedProps.tutupan_dominan ||
      mergedProps.tutupan_peta ||
      adminProps.tutupan_dominan ||
      "Permukiman";
    const tutupan = evaluasiTutupanLahanDay8(tutupanStr, lereng.derajat);

    // Evaluasi Triase & FS Terzaghi (Silent)
    const triase = evaluasiTriaseDay8(lereng, pedologi, litologi, hujan, tutupan);

    const kalurahan = mergedProps.kalurahan || adminProps.kalurahan || "-";
    const kapanewon = mergedProps.kapanewon || adminProps.kapanewon || "-";
    const kabupaten = mergedProps.kabupaten || adminProps.kabupaten || "DIY";

    // Cari nama Dusun/Padukuhan asli dari katalog 3.673 titik BIG RBI 25K (bukan inisial atau 'Dusun / Area')
    const dusunTerdekat = cariDusunTerdekatLokal(wgsLatLng.lat, wgsLatLng.lng, kalurahan);
    let namaDusun =
      dusunOverride ||
      mergedProps.nama_dusun ||
      dusunTerdekat ||
      mergedProps.dusun_utama ||
      adminProps.dusun_utama ||
      `Dusun ${kalurahan}`;
    if (
      String(namaDusun).toLowerCase().startsWith("dusun / area") ||
      String(namaDusun).toLowerCase().startsWith("wilayah") ||
      String(namaDusun).toUpperCase().startsWith("MTR-")
    ) {
      namaDusun = dusunTerdekat || adminProps.dusun_utama || `Dusun ${kalurahan}`;
    }

    const info = {
      sumberLabel: sumberLabel || "Inspeksi Spasial Titik Peta",
      namaDusun,
      kalurahan,
      kapanewon,
      kabupaten,
      easting,
      northing,
      latWgs84: wgsLatLng.lat,
      lonWgs84: wgsLatLng.lng,
      elevasiMdpl: mergedProps.elevasi_mdpl ?? mergedProps.elevasi_area_mdpl ?? adminProps.elevasi_mdpl ?? 115,
      lereng,
      pedologi,
      litologi,
      hujan,
      tutupan,
      triase,
      adminProps,
    };

    info.aiAdvisor = buatRekomendasiAiGeoteknik(info);
    return info;
  }

  // =========================================================================
  // 7. STYLING LAYER SPASIAL (CLEAN DEFAULT STATE + DYNAMIC HIGHLIGHT)
  // =========================================================================
  function apakahFiturLolosFilter(props) {
    if (state.filterKab !== "ALL" && props.kabupaten !== state.filterKab) {
      return false;
    }
    if (state.filterZona !== "ALL" && props._day8ZonaNama !== state.filterZona) {
      return false;
    }
    return true;
  }

  /**
   * Style Batas Administrasi:
   * - Secara default (Clean Default State), poligon TIDAK menutupi layar (fillOpacity: 0, opacity: 0).
   * - Poligon berwarna (Hijau/Kuning/Merah) HANYA muncul menyorot wilayah yang sedang diklik atau dicari user.
   * - Jika user mencentang "Garis Batas Administratif" di Layer Switcher, garis batas tipis ditampilkan.
   */
  function styleBatasAdmin(feature) {
    const p = feature.properties || {};
    const isSelected =
      state.selectedFeature &&
      state.selectedFeature.kalurahan === p.kalurahan &&
      state.selectedFeature.kapanewon === p.kapanewon &&
      state.selectedFeature.kabupaten === p.kabupaten;

    if (isSelected) {
      const hex = state.selectedTriageHex || p._day8Hex || TRIAGE_HEX.hijau;
      return {
        color: "#ffffff",
        weight: 3.0,
        opacity: 1.0,
        fillColor: hex,
        fillOpacity: state.polyOpacity,
      };
    }

    if (state.showAdminOutlines && apakahFiturLolosFilter(p)) {
      return {
        color: "#cbd5e1",
        weight: 1.0,
        opacity: 0.7,
        fillColor: p._day8Hex || TRIAGE_HEX.hijau,
        fillOpacity: 0.0,
      };
    }

    // Clean Default State: transparan penuh namun tetap interaktif saat diklik
    return {
      color: "transparent",
      weight: 0,
      opacity: 0,
      fillColor: "transparent",
      fillOpacity: 0,
    };
  }

  function renderSorotanDusunPadaPeta(info, nominatimGeojson) {
    state.dusunHighlightGroup.clearLayers();
    const hex = info.triase.hex;
    const centerLatLng = L.latLng(info.latWgs84, info.lonWgs84);

    // Jika Nominatim mengembalikan poligon batas dusun/desa spesifik
    if (
      nominatimGeojson &&
      (nominatimGeojson.type === "Polygon" || nominatimGeojson.type === "MultiPolygon")
    ) {
      L.geoJSON(nominatimGeojson, {
        style: {
          color: hex,
          weight: 2.8,
          dashArray: "6,4",
          fillColor: hex,
          fillOpacity: Math.min(0.65, state.polyOpacity + 0.1),
        },
      }).addTo(state.dusunHighlightGroup);
    } else {
      // Buffer zona mikro dusun / titik inspeksi (radius 280m) dengan warna triase
      L.circle(centerLatLng, {
        radius: 280,
        color: hex,
        weight: 2.4,
        dashArray: "5,4",
        fillColor: hex,
        fillOpacity: 0.28,
        interactive: false,
      }).addTo(state.dusunHighlightGroup);
    }

    // Pin Marker titik presisi Dusun / Koordinat
    L.circleMarker(centerLatLng, {
      radius: 8.5,
      fillColor: hex,
      color: "#ffffff",
      weight: 2.8,
      fillOpacity: 1.0,
    }).addTo(state.dusunHighlightGroup);
  }

  // =========================================================================
  // 8. REVERSE GEOCODING DUSUN / PADUKUHAN (NOMINATIM API)
  // =========================================================================
  const reverseGeoCache = {};

  async function ambilReverseGeocodingDusun(lat, lon) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (reverseGeoCache[key]) return reverseGeoCache[key];

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&zoom=18&addressdetails=1&polygon_geojson=1`;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const js = await res.json();
      const addr = js.address || {};
      const dusun =
        addr.hamlet ||
        addr.neighbourhood ||
        addr.quarter ||
        addr.suburb ||
        addr.residential ||
        addr.road ||
        addr.village ||
        null;
      const desa = addr.village || addr.suburb || addr.town || null;
      const kec = addr.municipality || addr.city_district || addr.district || null;
      const kab = addr.regency || addr.city || addr.county || null;

      const parsed = {
        dusun,
        desa,
        kec,
        kab,
        displayName: js.display_name || null,
        placeType: js.addresstype || js.type || "hamlet",
        geojson: js.geojson || null,
      };
      reverseGeoCache[key] = parsed;
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  // =========================================================================
  // 9. MODERN GLASSMORPHIC SIDEBAR & AI GEOTECHNICAL ADVISOR UI
  // =========================================================================
  function renderEmptyStateSidebar() {
    const panel = document.getElementById("inspector-panel");
    if (!panel) return;
    panel.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">🧭</div>
        <h2 style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:6px;">
          Siap Menginspeksi Titik &amp; Dusun
        </h2>
        <p style="font-size:12px;color:#475569;line-height:1.5;margin-bottom:12px;">
          Peta ditampilkan dalam kondisi bersih (<b>Clean Map View</b>). Klik sembarang titik di peta atau cari nama <b>Dusun / Padukuhan</b>, <b>Kalurahan</b>, atau <b>Kapanewon</b> untuk menampilkan sorotan zona triase dan rekomendasi geoteknik.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;">
          <button type="button" class="btn quick-sample-btn" data-dusun="Dusun Kinahrejo" data-lat="-7.5994" data-lon="110.4478">
            🌋 Dusun Kinahrejo
          </button>
          <button type="button" class="btn quick-sample-btn" data-dusun="Dusun Pokoh, Wedomartani" data-lat="-7.7167" data-lon="110.4186">
            🏡 Dusun Pokoh (Wedomartani)
          </button>
          <button type="button" class="btn quick-sample-btn" data-dusun="Dusun Mangunan, Dlingo" data-lat="-7.9408" data-lon="110.4247">
            ⛰️ Dusun Mangunan (Dlingo)
          </button>
        </div>
      </div>
    `;

    panel.querySelectorAll(".quick-sample-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lat = parseFloat(btn.getAttribute("data-lat"));
        const lon = parseFloat(btn.getAttribute("data-lon"));
        const label = btn.getAttribute("data-dusun");
        inspeksiTitikPeta(L.latLng(lat, lon), label, null);
        map.flyTo([lat, lon], 14.5, { duration: 0.8 });
      });
    });
  }

  function renderInspektor(info) {
    const panel = document.getElementById("inspector-panel");
    if (!panel) return;

    const { triase, lereng, pedologi, litologi, hujan, tutupan, aiAdvisor } = info;
    const fsInfo = triase.fsInfo;

    const fsBarPct = Math.min(100, Math.max(12, (fsInfo.fs / 2.5) * 100));
    const fsColor =
      fsInfo.statusKode === "stabil"
        ? "#10B981"
        : fsInfo.statusKode === "rawan"
        ? "#F59E0B"
        : "#EF4444";

    const labelDusun =
      info.namaDusun &&
      !info.namaDusun.toLowerCase().startsWith("wilayah") &&
      !info.namaDusun.toLowerCase().startsWith("dusun / area")
        ? info.namaDusun
        : cariDusunTerdekatLokal(info.latWgs84, info.lonWgs84, info.kalurahan) || `Dusun ${info.kalurahan}`;

    panel.innerHTML = `
      <!-- 1. HERO CARD: LABEL WILAYAH LENGKAP & BADGE STATUS TRIASE -->
      <div class="triage-hero-card ${triase.kode}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="triage-badge-pill ${triase.kode}">${triase.badge}</span>
          <span style="font-size:10.5px;font-weight:700;opacity:0.85;">Elevasi ±${formatAngka(info.elevasiMdpl, 1)} mdpl</span>
        </div>

        <div>
          <div class="region-dusun-title" id="sidebar-dusun-title">${labelDusun}</div>
          <div class="region-hierarchy-sub" id="sidebar-hierarchy-sub">
            Kalurahan ${info.kalurahan}, Kapanewon ${info.kapanewon}, ${info.kabupaten}
          </div>
        </div>

        <div class="region-coord-pills">
          <span class="coord-mini-tag" title="Koordinat Peta WGS84 (EPSG:4326)">
            🌐 ${info.latWgs84.toFixed(5)}°, ${info.lonWgs84.toFixed(5)}°
          </span>
          <span class="coord-mini-tag" title="Koordinat Metrik UTM Zone 49S (EPSG:32749)">
            📐 UTM: ${Math.round(info.easting).toLocaleString("id-ID")} mE, ${Math.round(info.northing).toLocaleString("id-ID")} mS
          </span>
        </div>
      </div>

      <!-- 2. INDIKATOR KESTABILAN LERENG (FS) -->
      <div class="fs-indicator-card">
        <div class="section-title" style="margin-bottom:6px;">
          <span>🛡️ Indikator Kestabilan Lereng (FS)</span>
        </div>
        <div class="fs-header-row">
          <div>
            <span style="font-size:11px;color:#64748b;display:block;">Faktor Keamanan Lereng (FS)</span>
            <span class="fs-value-num" style="color:${fsColor};">${formatAngka(fsInfo.fs, 2)}</span>
          </div>
          <span class="fs-status-chip ${fsInfo.statusKode}">${fsInfo.status}</span>
        </div>
        <div class="fs-bar-track">
          <div class="fs-bar-fill" style="width:${fsBarPct}%;background:${fsColor};"></div>
        </div>
        <div style="font-size:11px;color:#475569;margin-top:6px;line-height:1.4;">
          ${fsInfo.keterangan}
        </div>
      </div>

      <!-- 3. RINGKASAN KONDISI LAPANGAN -->
      <div class="section-card">
        <div class="section-title">
          <span>📋 Ringkasan Kondisi Lapangan</span>
        </div>
        <div class="field-summary-list">
          <div class="field-row">
            <div class="field-icon">⛰️</div>
            <div class="field-content">
              <div class="field-label">Kemiringan Lereng</div>
              <div class="field-val">${formatAngka(lereng.derajat, 2)}° (${formatAngka(lereng.persen, 2)}%)</div>
              <div class="field-sub">${lereng.kelas}</div>
            </div>
          </div>

          <div class="field-row">
            <div class="field-icon">🌱</div>
            <div class="field-content">
              <div class="field-label">Karakteristik Tanah (Pedologi)</div>
              <div class="field-val">${pedologi.nama}</div>
              <div class="field-sub">${pedologi.sifatRingkas}</div>
            </div>
          </div>

          <div class="field-row">
            <div class="field-icon">🪨</div>
            <div class="field-content">
              <div class="field-label">Jenis Batuan / Formasi Geologi</div>
              <div class="field-val">${litologi.nama}</div>
              <div class="field-sub">${litologi.litologi}</div>
            </div>
          </div>

          <div class="field-row">
            <div class="field-icon">🌧️</div>
            <div class="field-content">
              <div class="field-label">Estimasi Curah Hujan Tahunan</div>
              <div class="field-val">${formatAngka(hujan.chMm, 0)} mm/tahun</div>
              <div class="field-sub">Intensitas: ${hujan.kelas}</div>
            </div>
          </div>

          <div class="field-row">
            <div class="field-icon">🏡</div>
            <div class="field-content">
              <div class="field-label">Tutupan Lahan</div>
              <div class="field-val">${tutupan.nama}</div>
              <div class="field-sub">${tutupan.kategori}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. KARTU REKOMENDASI AHLI BERBASIS AI (AI GEOTECHNICAL ADVISOR CARD) -->
      <div class="ai-advisor-card">
        <div class="ai-advisor-header">
          <div class="ai-advisor-title">
            <span>🤖 AI Geotechnical Advisor</span>
          </div>
          <span class="ai-badge">Rekomendasi Ahli</span>
        </div>

        <div class="advisor-block diagnosa">
          <div class="advisor-block-title">⚠️ Diagnosa Bahaya Geoteknik</div>
          <div class="advisor-block-text">${aiAdvisor.diagnosa}</div>
        </div>

        <div class="advisor-block fondasi">
          <div class="advisor-block-title">🏗️ Rekomendasi Struktur &amp; Fondasi</div>
          <div class="advisor-block-text">${aiAdvisor.fondasi}</div>
        </div>

        <div class="advisor-block mitigasi">
          <div class="advisor-block-title">🛠️ Rekomendasi Mitigasi &amp; Drainase</div>
          <div class="advisor-block-text">${aiAdvisor.mitigasi}</div>
        </div>

        <div class="kpr-status-box ${triase.kode}">
          <div class="kpr-status-label">🏦 Status Kelayakan Kavling / KPR</div>
          <div class="kpr-status-value">${aiAdvisor.statusKpr}</div>
          <div class="kpr-status-desc">${aiAdvisor.descKpr}</div>
        </div>
      </div>
    `;
  }

  function buatPopupRingkas(info) {
    const { triase, lereng, pedologi } = info;
    return `
      <div style="min-width:240px;">
        <div style="margin-bottom:4px;">
          <span class="triage-badge-pill ${triase.kode}" style="font-size:9.5px;padding:2px 8px;">${triase.badge}</span>
        </div>
        <div class="popup-title" id="popup-dusun-title">${info.namaDusun}</div>
        <div class="popup-sub">Kal. ${info.kalurahan}, Kec. ${info.kapanewon}, ${info.kabupaten}</div>
        <div class="popup-grid">
          <div class="popup-cell">
            <span style="color:#64748b;font-size:10px;display:block;">Kemiringan Lereng</span>
            <b>${formatAngka(lereng.derajat, 1)}° (${formatAngka(lereng.persen, 1)}%)</b>
          </div>
          <div class="popup-cell">
            <span style="color:#64748b;font-size:10px;display:block;">Kestabilan (FS)</span>
            <b>${formatAngka(triase.fsInfo.fs, 2)} (${triase.fsInfo.status})</b>
          </div>
          <div class="popup-cell" style="grid-column:span 2;">
            <span style="color:#64748b;font-size:10px;display:block;">Tanah &amp; Kelayakan</span>
            <b>${pedologi.nama} — ${info.aiAdvisor.statusKpr}</b>
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 10. INSPEKSI KLIK PETA & GEOCODING DUSUN PRESISI
  // =========================================================================
  async function inspeksiTitikPeta(latlng, labelDusunAwal, rawPropsOverride, customPolygonGeojson) {
    if (!latlng) return;

    // Sinkronkan input koordinat di sidebar kiri
    const utm = latLngToUtm49s(latlng);
    const inLat = document.getElementById("input-lat");
    const inLon = document.getElementById("input-lon");
    const inUtmX = document.getElementById("input-utm-x");
    const inUtmY = document.getElementById("input-utm-y");
    if (inLat) inLat.value = latlng.lat.toFixed(5);
    if (inLon) inLon.value = latlng.lng.toFixed(5);
    if (inUtmX) inUtmX.value = Math.round(utm.easting);
    if (inUtmY) inUtmY.value = Math.round(utm.northing);

    const info = analisisSpasialTitik(rawPropsOverride, "Inspeksi Titik Peta", latlng, labelDusunAwal);

    // Set fitur terpilih & warna triase hanya pada wilayah yang dipilih
    state.selectedFeature = info.adminProps;
    state.selectedTriageHex = info.triase.hex;
    if (state.layers.admin) {
      state.layers.admin.setStyle(styleBatasAdmin);
    }

    renderSorotanDusunPadaPeta(info, customPolygonGeojson);
    renderInspektor(info);

    const popup = L.popup({ maxWidth: 310 })
      .setLatLng(latlng)
      .setContent(buatPopupRingkas(info))
      .openOn(map);

    // 1. Panggil endpoint Python Backend (/api/query pada serve_web.py & spatial_loader.py)
    //    untuk evaluasi geoteknik DAY 8, FS Terzaghi, dan nama Dusun asli dari TOPONIMI_PT_25K.shp
    try {
      const qs = new URLSearchParams({
        lat: latlng.lat.toFixed(6),
        lng: latlng.lng.toFixed(6),
        dusun: labelDusunAwal || "",
      });
      const resp = await fetch(`/api/query?${qs.toString()}`);
      if (resp.ok) {
        const bData = await resp.json();
        if (bData && bData.status === "ok" && bData.wilayah && bData.triase) {
          info.namaDusun = bData.wilayah.nama_dusun || info.namaDusun;
          info.kalurahan = bData.wilayah.kalurahan || info.kalurahan;
          info.kapanewon = bData.wilayah.kapanewon || info.kapanewon;
          info.kabupaten = bData.wilayah.kabupaten || info.kabupaten;
          info.elevasiMdpl = bData.wilayah.elevasi_mdpl ?? info.elevasiMdpl;

          if (bData.kondisi_lapangan) {
            info.lereng.derajat = Number(bData.kondisi_lapangan.lereng_derajat ?? info.lereng.derajat);
            info.lereng.persen = Number(bData.kondisi_lapangan.lereng_persen ?? info.lereng.persen);
            info.lereng.kelas = bData.kondisi_lapangan.kelas_lereng || info.lereng.kelas;
            info.lereng.skor =
              info.lereng.derajat > 35.0
                ? 5
                : info.lereng.derajat > 25.0
                ? 4
                : info.lereng.derajat > 15.0
                ? 3
                : info.lereng.derajat > 8.0
                ? 2
                : 1;
            info.pedologi.nama = bData.kondisi_lapangan.jenis_tanah || info.pedologi.nama;
            info.pedologi.sifatRingkas = bData.kondisi_lapangan.ket_tanah || info.pedologi.sifatRingkas;
            info.litologi.nama = bData.kondisi_lapangan.formasi_batuan || info.litologi.nama;
            info.litologi.litologi = bData.kondisi_lapangan.ket_batuan || info.litologi.litologi;
            info.hujan.chMm = Number(bData.kondisi_lapangan.curah_hujan_mm ?? info.hujan.chMm);
            info.hujan.kelas = bData.kondisi_lapangan.kelas_hujan || info.hujan.kelas;
            info.tutupan.nama = bData.kondisi_lapangan.tutupan_lahan || info.tutupan.nama;
            info.tutupan.kategori = bData.kondisi_lapangan.ket_tutupan || info.tutupan.kategori;
          }

          const zName = String(bData.triase.zona || "Zona Hijau");
          const zKode = zName.includes("Merah") ? "merah" : zName.includes("Kuning") ? "kuning" : "hijau";
          info.triase.kode = zKode;
          info.triase.namaZona = zName;
          info.triase.badge = bData.triase.badge || info.triase.badge;
          info.triase.hex = bData.triase.warna_hex || info.triase.hex;
          if (bData.triase.fs !== undefined) {
            info.triase.fsInfo.fs = Number(bData.triase.fs);
            const fLbl = String(bData.triase.fs_label || "STABIL");
            info.triase.fsInfo.status = fLbl === "STABIL" ? "Stabil" : fLbl === "RAWAN RAYAPAN" ? "Rawan Rayapan" : "Labil";
            info.triase.fsInfo.statusKode = fLbl === "STABIL" ? "stabil" : fLbl === "RAWAN RAYAPAN" ? "rawan" : "labil";
            info.triase.fsInfo.keterangan = bData.triase.fs_desc || info.triase.fsInfo.keterangan;
          }

          info.aiAdvisor = buatRekomendasiAiGeoteknik(info);
          if (bData.rekomendasi_ai) {
            info.aiAdvisor.diagnosa = bData.rekomendasi_ai.diagnosa_bahaya || info.aiAdvisor.diagnosa;
            info.aiAdvisor.fondasi = bData.rekomendasi_ai.struktur_fondasi || info.aiAdvisor.fondasi;
            info.aiAdvisor.mitigasi = bData.rekomendasi_ai.mitigasi_drainase || info.aiAdvisor.mitigasi;
            info.aiAdvisor.statusKpr = bData.rekomendasi_ai.status_kpr || info.aiAdvisor.statusKpr;
          }

          state.selectedTriageHex = info.triase.hex;
          if (state.layers.admin) {
            state.layers.admin.setStyle(styleBatasAdmin);
          }
          renderSorotanDusunPadaPeta(info, customPolygonGeojson);
          renderInspektor(info);
          if (popup && popup.isOpen()) {
            popup.setContent(buatPopupRingkas(info));
          }
          return;
        }
      }
    } catch (_errBackend) {
      // Lanjut gunakan hasil kalkulasi lokal & katalog 3.673 Dusun DIY bila dijalankan tanpa endpoint /api/query
    }

    // 2. Fallback opsional ke Nominatim hanya bila belum ada nama Dusun spesifik
    if (!labelDusunAwal && (!info.namaDusun || info.namaDusun === `Dusun ${info.kalurahan}`)) {
      const rev = await ambilReverseGeocodingDusun(latlng.lat, latlng.lng);
      if (rev && rev.dusun) {
        const dClean = String(rev.dusun).trim();
        const isJustDesa = dClean.toLowerCase() === String(info.kalurahan).toLowerCase();
        if (!isJustDesa) {
          info.namaDusun =
            dClean.toLowerCase().startsWith("dusun") ||
            dClean.toLowerCase().startsWith("padukuhan") ||
            dClean.toLowerCase().startsWith("kampung")
              ? dClean
              : `Dusun ${dClean}`;
          const elTitle = document.getElementById("sidebar-dusun-title");
          if (elTitle) elTitle.textContent = info.namaDusun;
          const elPopTitle = document.getElementById("popup-dusun-title");
          if (elPopTitle) elPopTitle.textContent = info.namaDusun;
          if (popup && popup.isOpen()) {
            popup.setContent(buatPopupRingkas(info));
          }
        }
      }
    }
  }

  function bersihkanPilihanPeta() {
    state.selectedFeature = null;
    state.dusunHighlightGroup.clearLayers();
    map.closePopup();
    if (state.layers.admin) {
      state.layers.admin.setStyle(styleBatasAdmin);
    }
    renderEmptyStateSidebar();
  }

  // =========================================================================
  // 11. LEGENDA PETA DINAMIS
  // =========================================================================
  function updateLegend() {
    const el = document.getElementById("map-legend");
    if (!el) return;

    if (state.activeLegendMode === "lereng") {
      el.innerHTML = `
        <div class="legend-title">⛰️ Kelas Kemiringan Lereng</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[1]};"></span><span>0° – 8° (0% – 14,1% | Datar–Landai)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[2]};"></span><span>&gt;8° – 15° (14,1% – 26,8% | Miring)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[3]};"></span><span>&gt;15° – 25° (26,8% – 46,6% | Agak Curam)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[4]};"></span><span>&gt;25° – 35° (46,6% – 70,0% | Curam)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[5]};"></span><span>&gt;35° (&gt;70,0% | Sangat Terjal)</span></div>
      `;
      return;
    }

    if (state.activeLegendMode === "geologi") {
      el.innerHTML = `
        <div class="legend-title">🪨 Litologi / Formasi Batuan (DAY 8)</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[5]};"></span><span>Skor 5: F. Semilir (Tmse), Sambipitu (Tmss), Nanggulan (Teon)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[4]};"></span><span>Skor 4: F. Nglanggran (Tmng), Kebobutak (Tomk)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[3]};"></span><span>Skor 3: F. Sentolo (Tmps), Gunungapi Merapi Tua (Qmo)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[2]};"></span><span>Skor 2: Formasi Gunungapi Merapi Muda (Qmi)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[1]};"></span><span>Skor 1: F. Wonosari (Tmwl), Klastik Fluvial (Qa)</span></div>
      `;
      return;
    }

    if (state.activeLegendMode === "tanah") {
      el.innerHTML = `
        <div class="legend-title">🌱 Karakteristik Tanah / Pedologi (DAY 8)</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[5]};"></span><span>Skor 5: Grumosol (c'=9 kPa, φ'=15°, Lempung Ekspansif)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[4]};"></span><span>Skor 4: Latosol &amp; Mediteran (c'=10 kPa, φ'=18°)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[3]};"></span><span>Skor 3: Regosol (c'=3,5 kPa, φ'=36°, Pasir Vulkanik)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[2]};"></span><span>Skor 2: Kambisol (c'=8 kPa, φ'=30°)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[1]};"></span><span>Skor 1: Aluvial (c'=14 kPa, φ'=25°, Dataran)</span></div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="legend-title">🛡️ Status Triase Geoteknik</div>
      <div class="legend-row">
        <span class="legend-swatch" style="background:#10B981;"></span>
        <span><b>Zona Hijau</b>: Aman / Risiko Rendah</span>
      </div>
      <div class="legend-row">
        <span class="legend-swatch" style="background:#F59E0B;"></span>
        <span><b>Zona Kuning</b>: Waspada / Perlu Mitigasi</span>
      </div>
      <div class="legend-row">
        <span class="legend-swatch" style="background:#EF4444;"></span>
        <span><b>Zona Merah</b>: Bahaya Kritis / Non-Buildable</span>
      </div>
      <div style="margin-top:5px;padding-top:5px;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b;">
        Klik titik mana saja di peta untuk menyorot batas wilayah &amp; analisis Dusun.
      </div>
    `;
  }

  // =========================================================================
  // 12. KATALOG DUSUN / PADUKUHAN DIY & LIVE GEOCODING SEARCH
  // =========================================================================
  const DUSUN_KATALOG_DIY = [
    { dusun: "Dusun Kinahrejo", kalurahan: "Umbulharjo", kapanewon: "Cangkringan", kabupaten: "Kab. Sleman", lat: -7.5994, lon: 110.4478 },
    { dusun: "Dusun Kaliadem", kalurahan: "Kepuharjo", kapanewon: "Cangkringan", kabupaten: "Kab. Sleman", lat: -7.5872, lon: 110.4561 },
    { dusun: "Dusun Pelemsari", kalurahan: "Umbulharjo", kapanewon: "Cangkringan", kabupaten: "Kab. Sleman", lat: -7.5945, lon: 110.4412 },
    { dusun: "Dusun Kalitengah Lor", kalurahan: "Glagaharjo", kapanewon: "Cangkringan", kabupaten: "Kab. Sleman", lat: -7.5785, lon: 110.4682 },
    { dusun: "Dusun Turgo", kalurahan: "Purwobinangun", kapanewon: "Pakem", kabupaten: "Kab. Sleman", lat: -7.5982, lon: 110.4225 },
    { dusun: "Dusun Kaliurang", kalurahan: "Hargobinangun", kapanewon: "Pakem", kabupaten: "Kab. Sleman", lat: -7.5974, lon: 110.4298 },
    { dusun: "Dusun Boyong", kalurahan: "Hargobinangun", kapanewon: "Pakem", kabupaten: "Kab. Sleman", lat: -7.6195, lon: 110.4214 },
    { dusun: "Dusun Pokoh", kalurahan: "Wedomartani", kapanewon: "Ngemplak", kabupaten: "Kab. Sleman", lat: -7.7167, lon: 110.4186 },
    { dusun: "Dusun Tajem", kalurahan: "Wedomartani", kapanewon: "Ngemplak", kabupaten: "Kab. Sleman", lat: -7.7412, lon: 110.4328 },
    { dusun: "Dusun Kregan", kalurahan: "Wedomartani", kapanewon: "Ngemplak", kabupaten: "Kab. Sleman", lat: -7.7245, lon: 110.4265 },
    { dusun: "Dusun Malangrejo", kalurahan: "Wedomartani", kapanewon: "Ngemplak", kabupaten: "Kab. Sleman", lat: -7.7318, lon: 110.4211 },
    { dusun: "Dusun Pogung Dalangan", kalurahan: "Sinduadi", kapanewon: "Mlati", kabupaten: "Kab. Sleman", lat: -7.7618, lon: 110.3734 },
    { dusun: "Dusun Karangjati", kalurahan: "Sinduadi", kapanewon: "Mlati", kabupaten: "Kab. Sleman", lat: -7.7689, lon: 110.3672 },
    { dusun: "Dusun Babarsari", kalurahan: "Caturtunggal", kapanewon: "Depok", kabupaten: "Kab. Sleman", lat: -7.7792, lon: 110.4148 },
    { dusun: "Dusun Seturan", kalurahan: "Caturtunggal", kapanewon: "Depok", kabupaten: "Kab. Sleman", lat: -7.7695, lon: 110.4092 },
    { dusun: "Dusun Karanggayam", kalurahan: "Caturtunggal", kapanewon: "Depok", kabupaten: "Kab. Sleman", lat: -7.7642, lon: 110.3824 },
    { dusun: "Dusun Klajuran", kalurahan: "Sidokarto", kapanewon: "Godean", kabupaten: "Kab. Sleman", lat: -7.7725, lon: 110.3084 },
    { dusun: "Dusun Kowanan", kalurahan: "Sidoarum", kapanewon: "Godean", kabupaten: "Kab. Sleman", lat: -7.7748, lon: 110.3176 },
    { dusun: "Dusun Breksi / Nglengkong", kalurahan: "Sambirejo", kapanewon: "Prambanan", kabupaten: "Kab. Sleman", lat: -7.7815, lon: 110.5046 },
    { dusun: "Dusun Sengir", kalurahan: "Sumberharjo", kapanewon: "Prambanan", kabupaten: "Kab. Sleman", lat: -7.8012, lon: 110.5125 },
    { dusun: "Dusun Kasongan", kalurahan: "Bangunjiwo", kapanewon: "Kasihan", kabupaten: "Kab. Bantul", lat: -7.8452, lon: 110.3374 },
    { dusun: "Dusun Kalipucang", kalurahan: "Bangunjiwo", kapanewon: "Kasihan", kabupaten: "Kab. Bantul", lat: -7.8568, lon: 110.3245 },
    { dusun: "Dusun Gendeng", kalurahan: "Bangunjiwo", kapanewon: "Kasihan", kabupaten: "Kab. Bantul", lat: -7.8614, lon: 110.3198 },
    { dusun: "Dusun Krapyak", kalurahan: "Panggungharjo", kapanewon: "Sewon", kabupaten: "Kab. Bantul", lat: -7.8275, lon: 110.3618 },
    { dusun: "Dusun Mangunan", kalurahan: "Mangunan", kapanewon: "Dlingo", kabupaten: "Kab. Bantul", lat: -7.9408, lon: 110.4247 },
    { dusun: "Dusun Sukorame", kalurahan: "Mangunan", kapanewon: "Dlingo", kabupaten: "Kab. Bantul", lat: -7.9462, lon: 110.4315 },
    { dusun: "Dusun Becici / Gunungcilik", kalurahan: "Muntuk", kapanewon: "Dlingo", kabupaten: "Kab. Bantul", lat: -7.8812, lon: 110.4368 },
    { dusun: "Dusun Giriloyo", kalurahan: "Wukirsari", kapanewon: "Imogiri", kabupaten: "Kab. Bantul", lat: -7.9114, lon: 110.4025 },
    { dusun: "Dusun Nawungan", kalurahan: "Selopamioro", kapanewon: "Imogiri", kabupaten: "Kab. Bantul", lat: -7.9685, lon: 110.3912 },
    { dusun: "Dusun Parangkusumo", kalurahan: "Parangtritis", kapanewon: "Kretek", kabupaten: "Kab. Bantul", lat: -8.0215, lon: 110.3248 },
    { dusun: "Dusun Grogol", kalurahan: "Parangtritis", kapanewon: "Kretek", kabupaten: "Kab. Bantul", lat: -8.0124, lon: 110.3352 },
    { dusun: "Dusun Srimulyo / Bukit Bintang", kalurahan: "Srimulyo", kapanewon: "Piyungan", kabupaten: "Kab. Bantul", lat: -7.8458, lon: 110.4792 },
  ];

  let liveNominatimResults = [];
  let searchDebounceTimer = null;

  async function cariGeocodingNominatimLive(query) {
    const q = (query || "").trim();
    if (q.length < 3) {
      liveNominatimResults = [];
      return;
    }
    const hintEl = document.getElementById("search-status-hint");
    if (hintEl) hintEl.textContent = `⏳ Mencari lokasi "${q}" di wilayah DIY...`;

    const searchQuery =
      q.toLowerCase().includes("yogyakarta") ||
      q.toLowerCase().includes("sleman") ||
      q.toLowerCase().includes("bantul")
        ? q
        : `${q}, Daerah Istimewa Yogyakarta`;

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      searchQuery
    )}&countrycodes=id&viewbox=110.0,-7.5,110.85,-8.15&bounded=0&addressdetails=1&polygon_geojson=1&limit=6`;

    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      liveNominatimResults = (data || [])
        .filter((it) => {
          const lat = parseFloat(it.lat);
          const lon = parseFloat(it.lon);
          return lat >= -8.25 && lat <= -7.45 && lon >= 109.95 && lon <= 110.95;
        })
        .map((it) => {
          const addr = it.address || {};
          const dusunName =
            it.name ||
            addr.hamlet ||
            addr.neighbourhood ||
            addr.suburb ||
            addr.village ||
            it.display_name.split(",")[0];
          const desa = addr.village || addr.suburb || addr.town || "";
          const kec = addr.municipality || addr.city_district || addr.district || "";
          const kab = addr.regency || addr.city || addr.county || "DIY";
          return {
            badge: "DUSUN / OSM",
            badgeClass: "dusun",
            label: dusunName,
            sub: [desa, kec, kab].filter(Boolean).join(", "),
            lat: parseFloat(it.lat),
            lon: parseFloat(it.lon),
            geojson: it.geojson || null,
            isNominatim: true,
          };
        });
      renderDaftarPencarian(q, true);
      if (hintEl) {
        hintEl.textContent = `✔ Ditemukan hasil pencarian tingkat Dusun/Kalurahan/Kapanewon untuk "${q}".`;
      }
    } catch (_e) {
      if (hintEl) {
        hintEl.textContent = "Menampilkan hasil dari katalog Dusun & Kalurahan DIY.";
      }
    }
  }

  function renderDaftarPencarian(keyword, skipLiveTrigger) {
    const container = document.getElementById("search-results");
    if (!container) return;
    const rawQ = (keyword || "").trim();
    const q = rawQ.toLowerCase();

    if (!skipLiveTrigger) {
      clearTimeout(searchDebounceTimer);
      if (q.length >= 3) {
        searchDebounceTimer = setTimeout(() => {
          cariGeocodingNominatimLive(rawQ);
        }, 380);
      } else {
        liveNominatimResults = [];
      }
    }

    const semuaItem = [];
    const sumberDusun =
      window.LAHAN_AMAN_META && Array.isArray(window.LAHAN_AMAN_META.dusun_diy) && window.LAHAN_AMAN_META.dusun_diy.length
        ? window.LAHAN_AMAN_META.dusun_diy
        : DUSUN_KATALOG_DIY;

    // 1. Katalog 3.673 Dusun / Padukuhan Asli DIY (BIG RBI 25K TOPONIMI_PT_25K)
    for (const d of sumberDusun) {
      const kabD = d.kabupaten || "Kab. Sleman";
      const zonaD = d.zona_kerawanan || "Zona Hijau";
      if (state.filterKab !== "ALL" && kabD !== state.filterKab) continue;
      if (state.filterZona !== "ALL" && zonaD !== state.filterZona) continue;
      const namaD = d.nama_dusun || d.dusun || "";
      if (!namaD) continue;
      const zHex =
        zonaD === "Zona Merah"
          ? TRIAGE_HEX.merah
          : zonaD === "Zona Kuning"
          ? TRIAGE_HEX.kuning
          : TRIAGE_HEX.hijau;
      semuaItem.push({
        badge: "DUSUN",
        badgeClass: "dusun",
        label: namaD,
        sub: `Kal. ${d.kalurahan}, Kec. ${d.kapanewon}, ${kabD}`,
        lat: Number(d.lat),
        lon: Number(d.lng ?? d.lon),
        zonaHex: zHex,
        zonaNama: zonaD,
        isDusun: true,
      });
    }

    // 2. Seluruh Kalurahan / Kapanewon / Kabupaten DIY
    for (const f of state.adminFeatures) {
      const p = f.properties;
      if (!apakahFiturLolosFilter(p)) continue;
      semuaItem.push({
        badge: "DESA",
        badgeClass: "desa",
        label: `${p.kalurahan}, ${p.kapanewon}`,
        sub: `${p.kabupaten} • ${p.dusun_utama || "Dusun " + p.kalurahan} • Lereng ${formatAngka(p.lereng_derajat, 1)}°`,
        props: p,
        zonaHex: p._day8Hex || TRIAGE_HEX.hijau,
        zonaNama: p._day8ZonaNama || "Zona Hijau",
      });
    }

    const badgeEl = document.getElementById("filter-count-badge");
    if (badgeEl) badgeEl.textContent = `${semuaItem.length} lokasi`;

    // 3. Deteksi input koordinat langsung (Lat/Lon atau UTM)
    const coordMatch = q.match(/^(-?\d+(\.\d+)?)\s*[,;\s]\s*(-?\d+(\.\d+)?)$/);
    let itemCoord = null;
    if (coordMatch) {
      const v1 = parseFloat(coordMatch[1]);
      const v3 = parseFloat(coordMatch[3]);
      if ((v1 < 0 && v1 > -15 && v3 > 90 && v3 < 150) || (v3 < 0 && v3 > -15 && v1 > 90 && v1 < 150)) {
        const lat = v1 < 0 ? v1 : v3;
        const lon = v1 < 0 ? v3 : v1;
        const u = latLngToUtm49s(L.latLng(lat, lon));
        itemCoord = {
          badge: "WGS84",
          badgeClass: "coord",
          label: `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`,
          sub: `UTM 49S: ${Math.round(u.easting)} mE, ${Math.round(u.northing)} mS`,
          isCoord: true,
          lat,
          lon,
        };
      } else if (v1 > 300000 && v1 < 600000 && v3 > 9000000 && v3 < 9300000) {
        const ll = utm49sToLatLng([v1, v3]);
        itemCoord = {
          badge: "UTM 49S",
          badgeClass: "coord",
          label: `X: ${Math.round(v1)}, Y: ${Math.round(v3)}`,
          sub: `WGS84: ${ll.lat.toFixed(5)}°, ${ll.lng.toFixed(5)}°`,
          isCoord: true,
          lat: ll.lat,
          lon: ll.lng,
        };
      }
    }

    const tokens = q.split(/[\s,]+/).filter(Boolean);
    let hasilLokal = q
      ? semuaItem.filter((it) => {
          const hay = `${it.label} ${it.sub}`.toLowerCase();
          return tokens.every((tk) => hay.includes(tk));
        })
      : semuaItem.slice(0, 14);

    // Gabungkan hasil Live Nominatim (Dusun/Padukuhan) + Lokal
    const gabungan = [];
    if (itemCoord) gabungan.push(itemCoord);
    for (const nom of liveNominatimResults) {
      if (!gabungan.some((x) => x.label.toLowerCase() === nom.label.toLowerCase())) {
        gabungan.push(nom);
      }
    }
    for (const loc of hasilLokal) {
      gabungan.push(loc);
    }

    const tampil = gabungan.slice(0, 22);

    if (!tampil.length) {
      container.innerHTML = `
        <div style="padding:10px;font-size:11.5px;color:#64748b;text-align:center;">
          Tekan tombol <b>Cari</b> untuk melacak Dusun "${rawQ}" melalui Geocoding OpenStreetMap.
        </div>
      `;
      return;
    }

    container.innerHTML = tampil
      .map(
        (it, idx) => `
        <div class="search-item" data-idx="${idx}">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:700;color:#0f172a;line-height:1.35;word-break:break-word;">
              <span class="place-type-badge ${it.badgeClass || "desa"}">${it.badge || "LOKASI"}</span>${it.label}
            </div>
            <div style="font-size:10.5px;color:#64748b;margin-top:2px;line-height:1.35;word-break:break-word;">
              ${it.sub}
            </div>
          </div>
          <span style="font-weight:800;font-size:11px;color:${it.zonaHex || "var(--primary-blue)"};flex-shrink:0;">
            ${it.zonaNama ? it.zonaNama.replace("Zona ", "") : "Pilih ➔"}
          </span>
        </div>
      `
      )
      .join("");

    container.querySelectorAll(".search-item").forEach((el, idx) => {
      el.addEventListener("click", () => {
        const item = tampil[idx];
        if (!item) return;

        if (item.isCoord || item.isDusun || item.isNominatim) {
          const ll = L.latLng(item.lat, item.lon);
          map.flyTo(ll, 14.5, { duration: 0.8 });
          inspeksiTitikPeta(ll, item.label, null, item.geojson || null);
          return;
        }

        if (item.props) {
          const ll = utm49sToLatLng([item.props.easting_x, item.props.northing_y]);
          const dusunDesa =
            item.props.dusun_utama ||
            cariDusunTerdekatLokal(ll.lat, ll.lng, item.props.kalurahan) ||
            `Dusun ${item.props.kalurahan}`;
          map.flyTo(ll, 13.75, { duration: 0.8 });
          inspeksiTitikPeta(ll, dusunDesa, item.props, null);
        }
      });
    });
  }

  // =========================================================================
  // 13. PEMUATAN DATASET GEOJSON EPSG:32749 & LAYER SWITCHER
  // =========================================================================
  function setLoading(msg) {
    const el = document.getElementById("loading-toast");
    if (!el) return;
    if (!msg) {
      el.style.display = "none";
    } else {
      el.textContent = msg;
      el.style.display = "block";
    }
  }

  async function fetchGeoJSON(filename) {
    if (window.LAHAN_AMAN_GEOJSON && window.LAHAN_AMAN_GEOJSON[filename]) {
      return window.LAHAN_AMAN_GEOJSON[filename];
    }
    if (filename === "clean_tutupan_lahan_diy.geojson") {
      if (window.LAHAN_AMAN_TUTUPAN) {
        return window.LAHAN_AMAN_TUTUPAN;
      }
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "tutupan_bundle.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
        if (window.LAHAN_AMAN_TUTUPAN) {
          return window.LAHAN_AMAN_TUTUPAN;
        }
      } catch (_err) {
        // fallback ke fetch HTTP
      }
    }
    const paths = [
      `../Data/processed/${filename}`,
      `/Data/processed/${filename}`,
      `Data/processed/${filename}`,
    ];
    for (const p of paths) {
      try {
        const res = await fetch(p);
        if (res.ok) return await res.json();
      } catch (_e) {
        // lanjut coba path berikutnya
      }
    }
    throw new Error(`Gagal memuat ${filename}`);
  }

  async function muatLayerUtama() {
    try {
      setLoading("⏳ Menyiapkan mesin geoteknik & data spasial DIY...");

      const [
        adminData,
        areaDevData,
        titikDevData,
        posHujanData,
        idwHujanData,
        demnasData,
      ] = await Promise.all([
        fetchGeoJSON("clean_batas_administrasi.geojson"),
        fetchGeoJSON("clean_area_jangkauan_titik.geojson"),
        fetchGeoJSON("clean_titik_developer.geojson"),
        fetchGeoJSON("clean_pos_hujan.geojson"),
        fetchGeoJSON("clean_curah_hujan_idw.geojson"),
        fetchGeoJSON("clean_demnas_diy_utm.geojson"),
      ]);

      let lerengPolyData = null;
      try {
        lerengPolyData = await fetchGeoJSON("clean_kemiringan_lereng_diy.geojson");
      } catch (_e) {
        lerengPolyData = null;
      }

      let geologiPolyData = null;
      try {
        geologiPolyData = await fetchGeoJSON("GJS Layer3_Geologi_SlemanBantul.geojson");
      } catch (_e1) {
        try {
          geologiPolyData = await fetchGeoJSON("day8_geologi.geojson");
        } catch (_e2) {
          geologiPolyData = null;
        }
      }

      let tanahPolyData = null;
      try {
        tanahPolyData = await fetchGeoJSON("GJS Layer2_JenisTanah_SlemanBantul.geojson");
      } catch (_e1) {
        try {
          tanahPolyData = await fetchGeoJSON("day8_jenis_tanah.geojson");
        } catch (_e2) {
          tanahPolyData = null;
        }
      }

      state.adminFeatures = adminData.features || [];
      state.devFeatures = titikDevData.features || [];
      state.areaDevFeatures = areaDevData.features || [];
      state.posFeatures = posHujanData.features || [];
      state.idwFeatures = idwHujanData.features || [];
      state.demnasFeatures = demnasData.features || [];
      state.lerengFeatures = lerengPolyData ? lerengPolyData.features || [] : [];
      state.geologiFeatures = geologiPolyData ? geologiPolyData.features || [] : [];
      state.tanahFeatures = tanahPolyData ? tanahPolyData.features || [] : [];

      // Evaluasi silent DAY 8 untuk seluruh poligon administrasi (untuk statistik & filter)
      let nHijau = 0,
        nKuning = 0,
        nMerah = 0;

      for (const f of state.adminFeatures) {
        const p = f.properties;
        const l = evaluasiKemiringanDay8(p.lereng_derajat, p.lereng_persen);
        const pd = evaluasiPedologiDay8(p.jenis_tanah);
        const lt = evaluasiLitologiDay8(p.formasi_batuan, p.litologi_penyusun);
        const hj = evaluasiCurahHujanDay8(p.ch_idw_mm);
        const tu = evaluasiTutupanLahanDay8(p.tutupan_dominan, l.derajat);
        const tr = evaluasiTriaseDay8(l, pd, lt, hj, tu);

        p._day8Hex = tr.hex;
        p._day8ZonaNama = tr.namaZona;
        p._day8SkorTanah = pd.skor;
        p._day8SkorBatuan = lt.skor;

        if (tr.kode === "hijau") nHijau++;
        else if (tr.kode === "kuning") nKuning++;
        else nMerah++;
      }

      document.getElementById("stat-hijau").textContent = String(nHijau);
      document.getElementById("stat-kuning").textContent = String(nKuning);
      document.getElementById("stat-merah").textContent = String(nMerah);

      // 1. Layer Batas Administrasi (Aktif di peta namun transparan saat Clean Default State)
      state.layers.admin = buatLayerGeoJsonUTM(adminData, {
        renderer: canvasRenderer,
        style: styleBatasAdmin,
      }).addTo(map);

      // 2. Layer Poligon Kemiringan Lereng DIY (Opsional di Layer Switcher)
      if (lerengPolyData) {
        state.layers.lerengPoly = buatLayerGeoJsonUTM(lerengPolyData, {
          renderer: canvasRenderer,
          interactive: false,
          style: (feature) => {
            const s = Number(feature.properties.skor || feature.properties.skor_leren || feature.properties.skor_lereng || 1);
            return {
              color: "#0f172a",
              weight: 0.35,
              fillColor: SLOPE_COLORS[s] || "#1a9850",
              fillOpacity: 0.65,
            };
          },
        });
      }

      // 3. Layer Tematik Litologi / Formasi Batuan Murni DAY 8 (GJS Layer3_Geologi_SlemanBantul.geojson)
      if (geologiPolyData) {
        state.layers.geologi = buatLayerGeoJsonUTM(geologiPolyData, {
          renderer: canvasRenderer,
          interactive: true,
          style: (feature) => {
            const fp = feature.properties || {};
            const s = Number(fp.skor_batuan) || evaluasiLitologiDay8(`${fp.NAME || ""} (${fp.SYMBOLS || ""})`, fp.ket_batuan).skor || 2;
            return {
              color: "#1e293b",
              weight: 1.1,
              fillColor: SCORE_COLORS[s] || "#38BDF8",
              fillOpacity: 0.58,
            };
          },
          onEachFeature: (feature, layer) => {
            const fp = feature.properties || {};
            const infoLito = evaluasiLitologiDay8(`${fp.NAME || ""} (${fp.SYMBOLS || ""})`, fp.ket_batuan);
            layer.bindTooltip(
              `<b>🪨 ${infoLito.nama}</b><br><span style="font-size:11px;">${infoLito.litologi}</span>`,
              { sticky: true }
            );
            layer.on("click", (ev) => {
              inspeksiTitikPeta(ev.latlng, null, null);
            });
          },
        });
      }

      // 4. Layer Tematik Karakteristik Tanah / Pedologi Murni DAY 8 (GJS Layer2_JenisTanah_SlemanBantul.geojson)
      if (tanahPolyData) {
        state.layers.tanah = buatLayerGeoJsonUTM(tanahPolyData, {
          renderer: canvasRenderer,
          interactive: true,
          style: (feature) => {
            const fp = feature.properties || {};
            const s = Number(fp["skor tanah"] || fp.skor_tanah) || evaluasiPedologiDay8(fp.jns_tnh).skor || 3;
            return {
              color: "#1e293b",
              weight: 1.1,
              fillColor: SCORE_COLORS[s] || "#FACC15",
              fillOpacity: 0.58,
            };
          },
          onEachFeature: (feature, layer) => {
            const fp = feature.properties || {};
            const infoTanah = evaluasiPedologiDay8(fp.jns_tnh);
            layer.bindTooltip(
              `<b>🌱 ${infoTanah.kategori}</b><br><span style="font-size:11px;">c' = ${infoTanah.cPrime} kPa, φ' = ${infoTanah.phiPrime}° — ${infoTanah.sifatRingkas}</span>`,
              { sticky: true }
            );
            layer.on("click", (ev) => {
              inspeksiTitikPeta(ev.latlng, null, null);
            });
          },
        });
      }

      // 5. Layer Kontur Curah Hujan IDW (Opsional di Layer Switcher)
      state.layers.idwHujan = buatLayerGeoJsonUTM(idwHujanData, {
        renderer: canvasRenderer,
        interactive: false,
        style: (feature) => ({
          color: "#ffffff",
          weight: 1.4,
          dashArray: "5,3",
          fillColor: feature.properties.warna_hex || SCORE_COLORS[feature.properties.skor || 3],
          fillOpacity: 0.5,
        }),
      });

      // 6. Layer Grid DEMNAS DIY UTM (Opsional di Layer Switcher)
      state.layers.demnas = buatLayerGeoJsonUTM(demnasData, {
        renderer: canvasRenderer,
        interactive: false,
        style: () => ({
          color: "#a855f7",
          weight: 1.8,
          dashArray: "6,4",
          fillColor: "#9333ea",
          fillOpacity: 0.12,
        }),
      });

      // 7. Layer Area Jangkauan Uji Developer (Opsional di Layer Switcher)
      state.layers.areaDev = buatLayerGeoJsonUTM(areaDevData, {
        renderer: canvasRenderer,
        style: (feature) => {
          const p = feature.properties;
          const l = evaluasiKemiringanDay8(p.lereng_area_derajat, p.lereng_area_persen);
          const pd = evaluasiPedologiDay8(p.jenis_tanah);
          const lt = evaluasiLitologiDay8(p.formasi_batuan, "");
          const hj = evaluasiCurahHujanDay8(p.ch_idw_area_mm);
          const tu = evaluasiTutupanLahanDay8(p.tutupan_dominan, l.derajat);
          const tr = evaluasiTriaseDay8(l, pd, lt, hj, tu);
          return {
            color: "#ffffff",
            weight: 1.5,
            dashArray: "3,3",
            fillColor: tr.hex,
            fillOpacity: 0.45,
          };
        },
        onEachFeature: (feature, layer) => {
          layer.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            inspeksiTitikPeta(e.latlng, feature.properties.nama_dusun || null, feature.properties, null);
          });
        },
      });

      // 8. Layer Pos Hujan BBWS Serayu Opak (Opsional di Layer Switcher)
      state.layers.posHujan = buatLayerGeoJsonUTM(posHujanData, {
        pointToLayer: (_feature, latlng) =>
          L.circleMarker(latlng, {
            radius: 6.5,
            fillColor: "#0ea5e9",
            color: "#ffffff",
            weight: 2,
            fillOpacity: 0.95,
          }),
        onEachFeature: (feature, layer) => {
          layer.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            inspeksiTitikPeta(e.latlng, null, feature.properties, null);
          });
        },
      });

      // 9. Layer Titik Uji Developer (Opsional di Layer Switcher)
      state.layers.titikDev = buatLayerGeoJsonUTM(titikDevData, {
        pointToLayer: (feature, latlng) => {
          const p = feature.properties;
          const l = evaluasiKemiringanDay8(p.lereng_area_derajat, p.lereng_area_persen);
          const pd = evaluasiPedologiDay8(p.jenis_tanah);
          const lt = evaluasiLitologiDay8(p.formasi_batuan, "");
          const hj = evaluasiCurahHujanDay8(p.ch_idw_titik_mm);
          const tu = evaluasiTutupanLahanDay8(p.tutupan_dominan, l.derajat);
          const tr = evaluasiTriaseDay8(l, pd, lt, hj, tu);
          return L.circleMarker(latlng, {
            radius: 7.5,
            fillColor: tr.hex,
            color: "#0f172a",
            weight: 2.0,
            fillOpacity: 1.0,
          });
        },
        onEachFeature: (feature, layer) => {
          layer.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            inspeksiTitikPeta(e.latlng, feature.properties.nama_dusun || null, feature.properties, null);
          });
        },
      });

      // Tampilan Awal: Clean Default State (tanpa poligon menutupi layar)
      renderEmptyStateSidebar();
      updateLegend();
      renderDaftarPencarian("", true);
      setLoading(null);
    } catch (err) {
      console.error(err);
      setLoading("⚠️ Gagal memuat dataset spasial DIY.");
    }
  }

  async function toggleTutupanLahan(checked) {
    if (!checked) {
      if (state.layers.tutupan && map.hasLayer(state.layers.tutupan)) {
        map.removeLayer(state.layers.tutupan);
      }
      return;
    }
    if (state.tutupanLoaded && state.layers.tutupan) {
      state.layers.tutupan.addTo(map);
      return;
    }
    try {
      setLoading("⏳ Memuat layer Tutupan Lahan RBI 25K...");
      const data = await fetchGeoJSON("clean_tutupan_lahan_diy.geojson");
      state.tutupanFeatures = data.features || [];
      state.layers.tutupan = buatLayerGeoJsonUTM(data, {
        renderer: canvasRenderer,
        interactive: false,
        style: (feature) => {
          const tu = evaluasiTutupanLahanDay8(feature.properties.klasifikasi, 5);
          return {
            color: "#1e293b",
            weight: 0.25,
            fillColor: SCORE_COLORS[tu.skor] || "#38BDF8",
            fillOpacity: 0.55,
          };
        },
      }).addTo(map);
      state.tutupanLoaded = true;
      setLoading(null);
    } catch (err) {
      console.error(err);
      setLoading(null);
    }
  }

  // =========================================================================
  // 14. EVENT HANDLERS (MAP CLICK, LAYER SWITCHER, SEARCH, COORDINATES)
  // =========================================================================

  // Klik di sembarang titik di peta (Google Maps Hybrid maupun OpenStreetMap)
  map.on("click", (e) => {
    inspeksiTitikPeta(e.latlng, null, null, null);
  });

  map.on("mousemove", (e) => {
    const utm = latLngToUtm49s(e.latlng);
    const elUtm = document.getElementById("coord-utm");
    const elWgs = document.getElementById("coord-wgs");
    if (elUtm) {
      elUtm.textContent = `X: ${formatAngka(utm.easting, 1)} mE, Y: ${formatAngka(utm.northing, 1)} mS`;
    }
    if (elWgs) {
      elWgs.textContent = `${e.latlng.lat.toFixed(5)}°, ${e.latlng.lng.toFixed(5)}°`;
    }
  });

  // Corner Layer Switcher collapse/expand
  const btnToggleLayerPanel = document.getElementById("btn-toggle-layer-panel");
  const layerSwitcherEl = document.getElementById("map-layer-switcher");
  if (btnToggleLayerPanel && layerSwitcherEl) {
    btnToggleLayerPanel.addEventListener("click", () => {
      layerSwitcherEl.classList.toggle("collapsed");
    });
  }

  // Checkbox Garis Batas Administratif
  const chkAdmin = document.getElementById("chk-admin");
  if (chkAdmin) {
    chkAdmin.addEventListener("change", (e) => {
      state.showAdminOutlines = e.target.checked;
      if (state.layers.admin) {
        state.layers.admin.setStyle(styleBatasAdmin);
      }
    });
  }

  // Checkbox Layer Spasial lainnya
  const overlayToggles = [
    ["chk-lereng-poly", "lerengPoly"],
    ["chk-geologi", "geologi"],
    ["chk-tanah", "tanah"],
    ["chk-idw-hujan", "idwHujan"],
    ["chk-area-dev", "areaDev"],
    ["chk-titik-dev", "titikDev"],
    ["chk-pos-hujan", "posHujan"],
    ["chk-demnas", "demnas"],
  ];

  for (const [id, key] of overlayToggles) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("change", (e) => {
      const lyr = state.layers[key];
      if (!lyr) return;
      if (e.target.checked) {
        lyr.addTo(map);
        if (key === "lerengPoly") state.activeLegendMode = "lereng";
        else if (key === "geologi") state.activeLegendMode = "geologi";
        else if (key === "tanah") state.activeLegendMode = "tanah";
      } else {
        map.removeLayer(lyr);
        const chkL = document.getElementById("chk-lereng-poly");
        const chkG = document.getElementById("chk-geologi");
        const chkT = document.getElementById("chk-tanah");
        if (chkL && chkL.checked) state.activeLegendMode = "lereng";
        else if (chkG && chkG.checked) state.activeLegendMode = "geologi";
        else if (chkT && chkT.checked) state.activeLegendMode = "tanah";
        else state.activeLegendMode = "triase";
      }
      updateLegend();
    });
  }

  const chkTutupan = document.getElementById("chk-tutupan");
  if (chkTutupan) {
    chkTutupan.addEventListener("change", (e) => {
      toggleTutupanLahan(e.target.checked);
    });
  }

  // Search Input & Button
  const searchInput = document.getElementById("search-input");
  const btnSearchGo = document.getElementById("btn-search-go");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      renderDaftarPencarian(e.target.value, false);
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cariGeocodingNominatimLive(searchInput.value);
      }
    });
  }

  if (btnSearchGo && searchInput) {
    btnSearchGo.addEventListener("click", () => {
      cariGeocodingNominatimLive(searchInput.value);
    });
  }

  // Filter Kabupaten & Zona Triase
  const filterKabEl = document.getElementById("filter-kabupaten");
  if (filterKabEl) {
    filterKabEl.addEventListener("change", (e) => {
      state.filterKab = e.target.value;
      if (state.layers.admin) state.layers.admin.setStyle(styleBatasAdmin);
      renderDaftarPencarian(searchInput ? searchInput.value : "", true);
    });
  }

  const filterZonaEl = document.getElementById("filter-zona");
  if (filterZonaEl) {
    filterZonaEl.addEventListener("change", (e) => {
      state.filterZona = e.target.value;
      if (state.layers.admin) state.layers.admin.setStyle(styleBatasAdmin);
      renderDaftarPencarian(searchInput ? searchInput.value : "", true);
    });
  }

  // Opacity Slider
  const polyOpacityEl = document.getElementById("poly-opacity");
  if (polyOpacityEl) {
    polyOpacityEl.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      const lbl = document.getElementById("opacity-val");
      if (lbl) lbl.textContent = `${val}%`;
      state.polyOpacity = val / 100;
      if (state.layers.admin) state.layers.admin.setStyle(styleBatasAdmin);
    });
  }

  // Basemap Switcher (Google Maps Hybrid, OpenStreetMap, dll.)
  const basemapSelectEl = document.getElementById("basemap-select");
  if (basemapSelectEl) {
    basemapSelectEl.addEventListener("change", (e) => {
      const key = e.target.value;
      Object.values(basemaps).forEach((b) => {
        if (map.hasLayer(b)) map.removeLayer(b);
      });
      if (basemaps[key]) basemaps[key].addTo(map).bringToBack();
    });
  }

  // Tabs Koordinat WGS84 & UTM 49S
  const btnTabWgs = document.getElementById("btn-tab-wgs");
  const btnTabUtm = document.getElementById("btn-tab-utm");
  const paneWgs = document.getElementById("pane-method-wgs");
  const paneUtm = document.getElementById("pane-method-utm");

  if (btnTabWgs && btnTabUtm && paneWgs && paneUtm) {
    btnTabWgs.addEventListener("click", () => {
      btnTabWgs.classList.add("active");
      btnTabUtm.classList.remove("active");
      paneWgs.style.display = "block";
      paneUtm.style.display = "none";
    });
    btnTabUtm.addEventListener("click", () => {
      btnTabUtm.classList.add("active");
      btnTabWgs.classList.remove("active");
      paneUtm.style.display = "block";
      paneWgs.style.display = "none";
    });
  }

  const inLat = document.getElementById("input-lat");
  const inLon = document.getElementById("input-lon");
  const inUtmX = document.getElementById("input-utm-x");
  const inUtmY = document.getElementById("input-utm-y");

  function sinkronLatLonKeUtm() {
    const lat = Number(inLat.value);
    const lon = Number(inLon.value);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const u = latLngToUtm49s(L.latLng(lat, lon));
      if (inUtmX) inUtmX.value = Math.round(u.easting);
      if (inUtmY) inUtmY.value = Math.round(u.northing);
    }
  }

  function sinkronUtmKeLatLon() {
    const x = Number(inUtmX.value);
    const y = Number(inUtmY.value);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const ll = utm49sToLatLng([x, y]);
      if (inLat) inLat.value = ll.lat.toFixed(5);
      if (inLon) inLon.value = ll.lng.toFixed(5);
    }
  }

  if (inLat && inLon) {
    inLat.addEventListener("input", sinkronLatLonKeUtm);
    inLon.addEventListener("input", sinkronLatLonKeUtm);
  }
  if (inUtmX && inUtmY) {
    inUtmX.addEventListener("input", sinkronUtmKeLatLon);
    inUtmY.addEventListener("input", sinkronUtmKeLatLon);
  }

  const btnAnalyzeCoords = document.getElementById("btn-analyze-coords");
  if (btnAnalyzeCoords) {
    btnAnalyzeCoords.addEventListener("click", () => {
      const lat = Number(inLat.value);
      const lon = Number(inLon.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const ll = L.latLng(lat, lon);
        map.flyTo(ll, 14.5, { duration: 0.8 });
        inspeksiTitikPeta(ll, null, null, null);
      }
    });
  }

  const btnGotoUtm = document.getElementById("btn-goto-utm");
  if (btnGotoUtm) {
    btnGotoUtm.addEventListener("click", () => {
      const x = Number(inUtmX.value);
      const y = Number(inUtmY.value);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const ll = utm49sToLatLng([x, y]);
        map.flyTo(ll, 14.5, { duration: 0.8 });
        inspeksiTitikPeta(ll, null, null, null);
      }
    });
  }

  // Tombol Topbar
  const btnClearSelection = document.getElementById("btn-clear-selection");
  if (btnClearSelection) {
    btnClearSelection.addEventListener("click", () => {
      bersihkanPilihanPeta();
    });
  }

  const btnResetView = document.getElementById("btn-reset-view");
  if (btnResetView) {
    btnResetView.addEventListener("click", () => {
      bersihkanPilihanPeta();
      map.flyTo([-7.785, 110.378], 11.0, { duration: 0.7 });
    });
  }

  // Jalankan inisialisasi aplikasi
  muatLayerUtama();
})();
