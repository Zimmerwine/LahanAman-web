/**
 * LahanAman GeoAnalytics DIY — Enterprise Geotechnical & Slope Stability WebGIS
 * Standar Koordinat Spasial: EPSG:32749 (WGS 84 / UTM Zone 49S) & EPSG:4326 (WGS 84)
 * Acuan Mekanika Tanah & Regulasi:
 *   - Permen PU No. 22/PRT/M/2007 & SNI 8291:2016 (5 Parameter GPKG: Lereng 30%, Tanah 25%, Batuan 20%, Hujan 15%, Lahan 10%)
 *   - Matriks Empiris Pengujian Lab Lokal DIY ('Dasar.xlsx')
 *   - Metode Analitis Lereng Tak Terhingga (Infinite Slope Factor of Safety / FS)
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
  // 2. INISIALISASI PETA LEAFLET
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
  // 3. STATE APLIKASI & PALET WARNA TEMATIK SPASIAL
  // =========================================================================
  const GAMMA_W = 9.81; // Berat isi air (kN/m³)

  const TRIAGE_HEX = {
    hijau: "#2E7D32",
    kuning: "#FB8C00",
    merah: "#D32F2F",
  };

  const SCORE_COLORS = {
    1: "#2E7D32",
    2: "#66BB6A",
    3: "#FFB300",
    4: "#FB8C00",
    5: "#D32F2F",
  };

  const SLOPE_COLORS = {
    1: "#1a9850", // 0° – 8° (0% – 14.1%)
    2: "#66bd63", // >8° – 15° (14.1% – 26.8%)
    3: "#facc15", // >15° – 25° (26.8% – 46.6%)
    4: "#f97316", // >25° – 35° (46.6% – 70.0%)
    5: "#ef4444", // >35° (>70.0%)
  };

  const RAINFALL_COLORS = {
    1: "#1F7A1F", // < 1.500 mm/tahun (m = 0.30)
    2: "#66CC00", // 1.500 - 2.000 mm/tahun (m = 0.45)
    3: "#FFFF00", // 2.001 - 2.500 mm/tahun (m = 0.60)
    4: "#FF8C00", // 2.501 - 3.000 mm/tahun (m = 0.75)
    5: "#FF1A00", // > 3.000 mm/tahun (m = 0.90)
  };

  const LAYER_META = [
    { key: "kerawananLongsor", chkId: "chk-kerawanan-longsor", label: "⚠️ Peta Skoring Kerawanan Longsor (GPKG)", defaultOpacity: 0.65, hasOpacity: true },
    { key: "lerengPoly", chkId: "chk-lereng-poly", label: "⛰️ Kemiringan Lereng (DEMNAS)", defaultOpacity: 0.65, hasOpacity: true },
    { key: "geologi", chkId: "chk-geologi", label: "🪨 Litologi & Formasi Geologi", defaultOpacity: 0.60, hasOpacity: true },
    { key: "tanah", chkId: "chk-tanah", label: "🌱 Karakteristik Tanah (Pedologi)", defaultOpacity: 0.60, hasOpacity: true },
    { key: "idwHujan", chkId: "chk-hujan", label: "🌧️ Curah Hujan Tahunan (Isohyet)", defaultOpacity: 0.60, hasOpacity: true },
    { key: "tutupan", chkId: "chk-tutupan", label: "🏡 Tutupan Lahan (RBI 25K)", defaultOpacity: 0.60, hasOpacity: true },
    { key: "admin", chkId: "chk-admin", label: "🗺️ Garis Batas Administrasi Kalurahan", defaultOpacity: 0.75, hasOpacity: true },
    { key: "titikDev", chkId: "chk-titik-dev", label: "📍 Titik Uji Sampel Developer", defaultOpacity: 0.95, hasOpacity: false },
    { key: "areaDev", chkId: "chk-area-dev", label: "⭕ Radius Jangkauan Uji (500m)", defaultOpacity: 0.50, hasOpacity: true },
    { key: "posHujan", chkId: "chk-pos-hujan", label: "💧 Pos Pengamatan Hujan BBWS", defaultOpacity: 0.95, hasOpacity: false },
    { key: "demnas", chkId: "chk-demnas", label: "📐 Grid Tile DEMNAS UTM", defaultOpacity: 0.20, hasOpacity: false },
  ];

  const state = {
    filterKab: "",
    filterKap: "",
    filterKal: "",
    filterZona: "ALL",
    polyOpacity: 0.55,
    showAdminOutlines: false,
    layerOpacities: {
      kerawananLongsor: 0.65,
      lerengPoly: 0.65,
      geologi: 0.60,
      tanah: 0.60,
      idwHujan: 0.60,
      tutupan: 0.60,
      admin: 0.75,
      areaDev: 0.50,
    },
    selectedFeature: null,
    selectedTriageHex: TRIAGE_HEX.hijau,
    inspectHighlightGroup: L.layerGroup().addTo(map),
    kavlingSegmentGroup: L.layerGroup().addTo(map),
    isDrawingKavling: false,
    activeKavlingResult: null,
    segmentLayersById: {},
    adminFeatures: [],
    devFeatures: [],
    areaDevFeatures: [],
    posFeatures: [],
    hujanFeatures: [],
    lerengFeatures: [],
    demnasFeatures: [],
    tutupanFeatures: [],
    kerawananFeatures: [],
    geologiFeatures: [],
    tanahFeatures: [],
    layers: {
      admin: null,
      kerawananLongsor: null,
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
    kerawananLoaded: false,
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
  // 4. LOGIKA ANALISIS & KALKULASI GEOTEKNIK TERPADU ('Dasar.xlsx' - MODUL 2)
  // =========================================================================

  /**
   * A. Kemiringan Lereng (β) - Bobot 30% (Murni dari poligon DEMNAS / lereng):
   *    - 0° - 8° (0% - 14,1%)   -> Skor 1 (Gaya gravitasi vertikal mengikat massa tanah, zona aman)
   *    - >8° - 15° (14,1% - 26,8%) -> Skor 2 (Zona transisi)
   *    - >15° - 25° (26,8% - 46,6%) -> Skor 3 (Kritis, berimpit sudut geser efektif lempung Semilir)
   *    - >25° - 35° (46,6% - 70,0%) -> Skor 4 (Berimpit sudut geser batupasir lapuk)
   *    - >35° (>70,0%)         -> Skor 5 (Ekstrem / Non-buildable)
   */
  function evaluasiKemiringanLereng(derajatInput, persenInput) {
    let deg = Number(derajatInput);
    let pct = Number(persenInput);
    if (!Number.isFinite(deg) && Number.isFinite(pct)) {
      deg = Math.atan(pct / 100) * (180 / Math.PI);
    } else if (Number.isFinite(deg) && !Number.isFinite(pct)) {
      pct = Math.tan((deg * Math.PI) / 180) * 100;
    }
    if (!Number.isFinite(deg) || deg < 0) {
      deg = 2.5;
      pct = Number((Math.tan((deg * Math.PI) / 180) * 100).toFixed(1));
    }

    let skor = 1;
    let label = "0° – 8° (0% – 14,1% | Datar – Landai)";
    let deskripsi = "Gaya gravitasi vertikal mengikat massa tanah, zona aman konstruksi standar";

    if (deg > 35.0 || pct > 70.0) {
      skor = 5;
      label = ">35° (>70,0% | Sangat Terjal / Ekstrem)";
      deskripsi = "Lereng ekstrem melampaui sudut geser dalam tanah, zona Non-Buildable";
    } else if (deg > 25.0 || pct > 46.6) {
      skor = 4;
      label = ">25° – 35° (46,6% – 70,0% | Sangat Curam)";
      deskripsi = "Berimpit sudut geser batupasir lapuk, tegangan geser gravitasi tinggi";
    } else if (deg > 15.0 || pct > 26.8) {
      skor = 3;
      label = ">15° – 25° (26,8% – 46,6% | Curam / Kritis)";
      deskripsi = "Kritis, berimpit sudut geser efektif lempung Formasi Semilir";
    } else if (deg > 8.0 || pct > 14.1) {
      skor = 2;
      label = ">8° – 15° (14,1% – 26,8% | Landai – Miring / Transisi)";
      deskripsi = "Zona transisi morfologi miring, perlu penataan drainase lereng";
    }

    return {
      skor,
      derajat: Number(deg.toFixed(2)),
      persen: Number(pct.toFixed(2)),
      kelas: label,
      deskripsi,
    };
  }

  /**
   * B. Karakteristik Tanah (Pedologi) - Bobot 25% ('Dasar.xlsx'):
   *    - Grumusol:  Skor 5 (c' = 9.0 kPa,  φ' = 15.0°, γsat = 19.0 kN/m³, z = 2.0 m)
   *    - Latosol:   Skor 4 (c' = 10.0 kPa, φ' = 18.0°, γsat = 18.5 kN/m³, z = 2.0 m)
   *    - Mediteran: Skor 4 (c' = 11.0 kPa, φ' = 20.0°, γsat = 18.5 kN/m³, z = 2.5 m)
   *    - Regosol:   Skor 3 (c' = 3.5 kPa,  φ' = 36.0°, γsat = 17.5 kN/m³, z = 1.0 m)
   *    - Kambisol:  Skor 2 (c' = 8.0 kPa,  φ' = 30.0°, γsat = 18.0 kN/m³, z = 2.0 m)
   *    - Aluvial:   Skor 1 (c' = 14.0 kPa, φ' = 25.0°, γsat = 18.5 kN/m³, z = 4.0 m)
   */
  function evaluasiPedologiTanah(jenisTanahRaw) {
    const raw = String(jenisTanahRaw || "Regosol").trim();
    const low = raw.toLowerCase();

    if (low.includes("grumosol") || low.includes("grumusol") || low.includes("vertisol") || low.includes("smektit")) {
      return {
        skor: 5,
        nama: "Grumusol (Vertisol)",
        cPrime: 9.0,
        phiPrime: 15.0,
        gammaSat: 19.0,
        zDepth: 2.0,
        isExpansive: true,
        sifatRingkas: "Lempung hitam smektit/montmorilonit ekspansif tinggi (c'=9,0 kPa, φ'=15,0°, γsat=19,0 kN/m³, z=2,0 m)",
      };
    }
    if (low.includes("mediteran") || low.includes("alfisol") || low.includes("terra rossa")) {
      return {
        skor: 4,
        nama: "Mediteran (Alfisol Karst/Vulkanik)",
        cPrime: 11.0,
        phiPrime: 20.0,
        gammaSat: 18.5,
        zDepth: 2.5,
        isExpansive: false,
        sifatRingkas: "Lempung pelapukan batugamping/breksi solum tebal (c'=11,0 kPa, φ'=20,0°, γsat=18,5 kN/m³, z=2,5 m)",
      };
    }
    if (low.includes("latosol") || low.includes("ultisol") || low.includes("andosol") || low.includes("litosol")) {
      return {
        skor: 4,
        nama: "Latosol (Pelapukan Lanjut)",
        cPrime: 10.0,
        phiPrime: 18.0,
        gammaSat: 18.5,
        zDepth: 2.0,
        isExpansive: false,
        sifatRingkas: "Lempung lanauan pelapukan vulkanik solum tebal (c'=10,0 kPa, φ'=18,0°, γsat=18,5 kN/m³, z=2,0 m)",
      };
    }
    if (low.includes("kambisol") || low.includes("brown forest") || low.includes("inceptisol")) {
      return {
        skor: 2,
        nama: "Kambisol (Inceptisol)",
        cPrime: 8.0,
        phiPrime: 30.0,
        gammaSat: 18.0,
        zDepth: 2.0,
        isExpansive: false,
        sifatRingkas: "Tanah perkembangan muda berdrainase sedang-baik (c'=8,0 kPa, φ'=30,0°, γsat=18,0 kN/m³, z=2,0 m)",
      };
    }
    if (low.includes("aluvial") && !low.includes("regosol")) {
      return {
        skor: 1,
        nama: "Aluvial (Endapan Dataran)",
        cPrime: 14.0,
        phiPrime: 25.0,
        gammaSat: 18.5,
        zDepth: 4.0,
        isExpansive: false,
        sifatRingkas: "Endapan lempung-lanau dataran banjir kohesif (c'=14,0 kPa, φ'=25,0°, γsat=18,5 kN/m³, z=4,0 m)",
      };
    }
    return {
      skor: 3,
      nama: "Regosol (Entisol Vulkanik)",
      cPrime: 3.5,
      phiPrime: 36.0,
      gammaSat: 17.5,
      zDepth: 1.0,
      isExpansive: false,
      sifatRingkas: "Pasir vulkanik lepas berkohesi rendah & sudut geser tinggi (c'=3,5 kPa, φ'=36,0°, γsat=17,5 kN/m³, z=1,0 m)",
    };
  }

  /**
   * C. Litologi & Formasi Geologi - Bobot 20% ('Dasar.xlsx'):
   *    - Tmse, Tms3 (Semilir), Tmss (Sambipitu), Teon (Nanggulan), na (Avalanche): Skor 5
   *    - Tmng (Nglanggran), Tomk (Kebobutak): Skor 4
   *    - Tmps (Sentolo), Qmo (Merapi Tua): Skor 3
   *    - Qmi, Qvu3 (Merapi Muda): Skor 2
   *    - Tmwl (Wonosari), Qa (Aluvial): Skor 1
   */
  function evaluasiLitologiGeologi(formasiRaw, litologiRaw) {
    const raw = String(formasiRaw || "Formasi Gunungapi Merapi Muda (Qmi)").trim();
    const lito = String(litologiRaw || "").trim();
    const fullLow = `${raw} ${lito}`.toLowerCase();

    if (fullLow.includes("semilir") || fullLow.includes("tmse") || fullLow.includes("tms3")) {
      return {
        skor: 5,
        nama: "Formasi Semilir (Tmse / Tms3)",
        litologi: "Batuan lemah 1–5 MPa (φ'=15°–25°), tuf-serpih-batuapung membentuk bidang gelincir kedap air",
      };
    }
    if (fullLow.includes("sambipitu") || fullLow.includes("tmss")) {
      return {
        skor: 5,
        nama: "Formasi Sambipitu (Tmss)",
        litologi: "Batuan lemah 1–5 MPa (φ'=15°–25°), perselingan batupasir tufan & serpih kedap air",
      };
    }
    if (fullLow.includes("nanggulan") || fullLow.includes("teon")) {
      return {
        skor: 5,
        nama: "Formasi Nanggulan (Teon)",
        litologi: "Batuan lemah 1–5 MPa (φ'=15°–25°), batulempung & napal Eosen membentuk bidang gelincir",
      };
    }
    if (fullLow.includes("avalanche") || fullLow.includes("koluvial") || fullLow.includes("(na)")) {
      return {
        skor: 5,
        nama: "Endapan Guguran Piroklastik / Avalanche (na)",
        litologi: "Material bongkah piroklastik belum terkonsolidasi (φ'=15°–25°), sangat rawan gelincir",
      };
    }
    if (fullLow.includes("nglanggran") || fullLow.includes("tmng") || fullLow.includes("jonggrangan")) {
      return {
        skor: 4,
        nama: "Formasi Nglanggran (Tmng)",
        litologi: "Breksi gunungapi & aglomerat berkekar rapat, diskontinuitas tinggi (φ'=25°–35°)",
      };
    }
    if (fullLow.includes("kebobutak") || fullLow.includes("tomk")) {
      return {
        skor: 4,
        nama: "Formasi Kebobutak (Tomk)",
        litologi: "Breksi andesit & tuf lapili berkekar rapat, diskontinuitas tinggi (φ'=25°–35°)",
      };
    }
    if (fullLow.includes("sentolo") || fullLow.includes("tmps") || fullLow.includes("dagotirto")) {
      return {
        skor: 3,
        nama: "Formasi Sentolo (Tmps)",
        litologi: "Batugamping napalan mengandung lempung smektit dengan pelapukan diferensial",
      };
    }
    if (fullLow.includes("merapi tua") || fullLow.includes("qmo") || fullLow.includes("turgo") || fullLow.includes("plawangan")) {
      return {
        skor: 3,
        nama: "Formasi Gunungapi Merapi Tua (Qmo)",
        litologi: "Breksi gunungapi tua & aliran lava andesit berlereng curam",
      };
    }
    if (fullLow.includes("wonosari") || fullLow.includes("tmwl") || fullLow.includes("tmw")) {
      return {
        skor: 1,
        nama: "Formasi Wonosari (Tmwl)",
        litologi: "Batugamping terumbu masif (reef limestone) berdaya dukung batuan dasar tinggi",
      };
    }
    if (fullLow.includes("aluvial") || fullLow.includes("qa") || fullLow.includes("wates") || fullLow.includes("fluvial")) {
      return {
        skor: 1,
        nama: "Endapan Aluvial Kuarter (Qa)",
        litologi: "Endapan dataran banjir kuarter pada morfologi datar stabil",
      };
    }
    return {
      skor: 2,
      nama: "Endapan Vulkanik Merapi Muda (Qmi / Qvu3)",
      litologi: "Pasir bergradasi baik (SW), tuf & breksi laharik permeabilitas tinggi (φ'=37°–48°)",
    };
  }

  /**
   * D. Curah Hujan Tahunan (Isohyet) - Bobot 15% ('Dasar.xlsx'):
   *    - >3.000 mm/tahun      -> Skor 5 (Rasio kejenuhan m = hw/z = 0.90)
   *    - 2.501 - 3.000 mm/tahun -> Skor 4 (Rasio m = 0.75)
   *    - 2.001 - 2.500 mm/tahun -> Skor 3 (Rasio m = 0.60)
   *    - 1.500 - 2.000 mm/tahun -> Skor 2 (Rasio m = 0.45)
   *    - <1.500 mm/tahun      -> Skor 1 (Rasio m = 0.30)
   */
  function evaluasiCurahHujanTahunan(chMmInput, skorOverride, rasioMOverride) {
    const ch = Number(chMmInput) || 2250;
    const mMap = { 1: 0.30, 2: 0.45, 3: 0.60, 4: 0.75, 5: 0.90 };
    const kelasMap = {
      1: "< 1.500 mm/tahun (Sangat Rendah | m = 0,30)",
      2: "1.500 – 2.000 mm/tahun (Rendah | m = 0,45)",
      3: "2.001 – 2.500 mm/tahun (Sedang | m = 0,60)",
      4: "2.501 – 3.000 mm/tahun (Tinggi | m = 0,75)",
      5: "> 3.000 mm/tahun (Sangat Tinggi | m = 0,90)",
    };

    let skor = 3;
    if (ch > 3000) skor = 5;
    else if (ch >= 2501) skor = 4;
    else if (ch >= 2001) skor = 3;
    else if (ch >= 1500) skor = 2;
    else skor = 1;

    const sOvr = Number(skorOverride);
    if (Number.isFinite(sOvr) && sOvr >= 1 && sOvr <= 5) {
      skor = Math.round(sOvr);
    }

    const mOvr = Number(rasioMOverride);
    const mRatio = Number.isFinite(mOvr) && mOvr > 0 && mOvr <= 1.0 ? mOvr : mMap[skor] || 0.60;

    return {
      skor,
      chMm: ch,
      mRatio,
      kelas: kelasMap[skor] || kelasMap[3],
    };
  }

  /**
   * E. Tutupan Lahan - Bobot 10% ('Dasar.xlsx'):
   *    - Tanah Terbuka / Tambang / Tegalan / Sawah lereng >8°: Skor 5 (Kohesi akar cr = 0 kPa, beban q = 0 kPa)
   *    - Semak Belukar / Alang-alang: Skor 4 (cr = 0.5 kPa, q = 0 kPa)
   *    - Permukiman / Bangunan / Jalan: Skor 3 (cr = 0 kPa, beban tambahan pondasi/bangunan q = 15 kPa)
   *    - Perkebunan / Kebun Campuran: Skor 2 (cr = 3.5 kPa, q = 0 kPa)
   *    - Hutan Lahan Kering / Lindung / Tubuh Air: Skor 1 (cr = 10.0 kPa, q = 0 kPa)
   */
  function evaluasiTutupanLahan(tutupanRaw, lerengDerajat) {
    const raw = String(tutupanRaw || "Permukiman").trim();
    const low = raw.toLowerCase();
    const beta = Number(lerengDerajat) || 0;

    if (
      low.includes("terbuka") ||
      low.includes("tambang") ||
      low.includes("tegalan") ||
      low.includes("ladang") ||
      low.includes("pasir") ||
      (low.includes("sawah") && beta > 8.0)
    ) {
      return {
        skor: 5,
        nama: raw,
        crKpa: 0.0,
        qKpa: 0.0,
        kategori: `${raw} — Tanpa perakaran dalam & infiltrasi tinggi (cr = 0 kPa, q = 0 kPa)`,
        warnaHex: "#D32F2F",
      };
    }
    if (low.includes("semak") || low.includes("belukar") || low.includes("alang") || low.includes("rumput") || low.includes("kosong")) {
      return {
        skor: 4,
        nama: raw,
        crKpa: 0.5,
        qKpa: 0.0,
        kategori: `${raw} — Perakaran dangkal & penahan air lemah (cr = 0,5 kPa, q = 0 kPa)`,
        warnaHex: "#FB8C00",
      };
    }
    if (low.includes("perkebunan") || low.includes("kebun") || low.includes("campur")) {
      return {
        skor: 2,
        nama: raw,
        crKpa: 3.5,
        qKpa: 0.0,
        kategori: `${raw} — Kohesi akar pohon tahunan sedang (cr = 3,5 kPa, q = 0 kPa)`,
        warnaHex: "#66BB6A",
      };
    }
    if (
      low.includes("hutan") ||
      low.includes("lindung") ||
      low.includes("sungai") ||
      low.includes("danau") ||
      low.includes("waduk") ||
      low.includes("kolam") ||
      low.includes("tambak") ||
      low.includes("air")
    ) {
      const isWater = low.includes("sungai") || low.includes("danau") || low.includes("waduk") || low.includes("air");
      return {
        skor: 1,
        nama: raw,
        crKpa: isWater ? 0.0 : 10.0,
        qKpa: 0.0,
        kategori: isWater
          ? `${raw} — Tubuh air / morfologi lembah dasar (cr = 0 kPa, q = 0 kPa)`
          : `${raw} — Perakaran hutan rapat menahan geser tanah (cr = 10,0 kPa, q = 0 kPa)`,
        warnaHex: isWater ? "#0284C7" : "#2E7D32",
      };
    }
    if (low.includes("sawah")) {
      return {
        skor: 3,
        nama: raw,
        crKpa: 0.0,
        qKpa: 0.0,
        kategori: `${raw} — Lahan basah datar tanpa beban bangunan (cr = 0 kPa, q = 0 kPa)`,
        warnaHex: "#FFB300",
      };
    }
    return {
      skor: 3,
      nama: raw,
      crKpa: 0.0,
      qKpa: 15.0,
      kategori: `${raw} — Beban tambahan konstruksi/bangunan (cr = 0 kPa, q = 15,0 kPa)`,
      warnaHex: "#FFB300",
    };
  }

  /**
   * 3. Formula Analitis Faktor Keamanan (FS) Lereng Tak Terhingga (Infinite Slope):
   *    FS = [ (c' + cr) + ((γsat * z - m * γw * z) + q) * (cos β)^2 * tan φ' ] / [ (γsat * z + q) * sin β * cos β ]
   *    - γw = 9.81 kN/m³
   *    - Jika β <= 2.0°, kunci FS = 5.00 karena topografi datar murni
   *    - Batasi nilai FS maksimal di angka 5.00
   *    - Klasifikasi Kestabilan (Wicaksono & Khafid, 2022 & SNI):
   *      * FS > 1.25        -> STABIL (Badge Hijau)
   *      * 1.07 <= FS <= 1.25 -> KRITIS (Badge Kuning)
   *      * FS < 1.07        -> LABIL / LONGSOR (Badge Merah)
   */
  function hitungInfiniteSlopeFS(lerengDerajat, pedologi, hujan, tutupan) {
    const betaDeg = Math.max(0.0, Number(lerengDerajat) || 0.0);
    const cPrime = Number(pedologi.cPrime) || 3.5;
    const crKpa = Number(tutupan.crKpa ?? 0.0);
    const phiPrime = Number(pedologi.phiPrime) || 30.0;
    const gammaSat = Number(pedologi.gammaSat) || 18.0;
    const zDepth = Number(pedologi.zDepth) || 2.0;
    const mRatio = Number(hujan.mRatio) || 0.60;
    const qKpa = Number(tutupan.qKpa ?? 15.0);

    // Tegangan air pori u = m * γw * z (kPa)
    const uKpa = Number((mRatio * GAMMA_W * zDepth).toFixed(2));

    let fsVal = 5.00;
    if (betaDeg <= 2.0) {
      fsVal = 5.00;
    } else {
      const betaRad = (betaDeg * Math.PI) / 180.0;
      const phiRad = (phiPrime * Math.PI) / 180.0;
      const cosB = Math.cos(betaRad);
      const sinB = Math.sin(betaRad);
      const tanPhi = Math.tan(phiRad);

      const totalCohesion = cPrime + crKpa;
      const effectiveNormal = ((gammaSat * zDepth - mRatio * GAMMA_W * zDepth) + qKpa) * (cosB * cosB);
      const resistingStress = totalCohesion + Math.max(0.0, effectiveNormal) * tanPhi;
      const drivingStress = (gammaSat * zDepth + qKpa) * sinB * cosB;

      if (drivingStress <= 1e-6) {
        fsVal = 5.00;
      } else {
        fsVal = Number(Math.min(5.00, Math.max(0.05, resistingStress / drivingStress)).toFixed(2));
      }
    }

    let status = "STABIL";
    let statusKode = "stabil";
    let warnaHex = "#2E7D32";
    let keterangan = "Lereng stabil terhadap gelincir translasi (FS > 1,25 — Wicaksono & Khafid, 2022 & SNI 8291:2016).";

    if (fsVal < 1.07) {
      status = "LABIL / LONGSOR";
      statusKode = "labil";
      warnaHex = "#D32F2F";
      keterangan = "Gaya penggerak melampaui tahanan geser efektif; lereng labil dan rawan longsor saat jenuh (FS < 1,07).";
    } else if (fsVal <= 1.25) {
      status = "KRITIS";
      statusKode = "rawan";
      warnaHex = "#FB8C00";
      keterangan = "Kestabilan lereng berada pada ambang kritis / rawan rayapan saat jenuh air pori (1,07 ≤ FS ≤ 1,25).";
    }

    return {
      fs: fsVal,
      cPrime,
      crKpa,
      phiPrime,
      gammaSat,
      zDepth,
      mRatio,
      uKpa,
      qKpa,
      status,
      statusKode,
      warnaHex,
      keterangan,
    };
  }

  /**
   * 1. Standar Pembobotan 5 Parameter GPKG (Permen PU No. 22/PRT/M/2007 & SNI 8291:2016):
   *    Skor Akhir = (Skor_Lereng * 0.30) + (Skor_Tanah * 0.25) + (Skor_Batuan * 0.20) + (Skor_Hujan * 0.15) + (Skor_Lahan * 0.10)
   *    - Skor Akhir < 2.20        -> ZONA HIJAU (Datar / Risiko Rendah / Konstruksi Standar)
   *    - Skor Akhir 2.20 - 3.40   -> ZONA KUNING (Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud)
   *    - Skor Akhir > 3.40        -> ZONA MERAH (Risiko Tinggi / Rawan Longsor / Non-Buildable)
   */
  function evaluasiZonaGPKG(lereng, pedologi, litologi, hujan, tutupan) {
    const kontribusiLereng = Number((lereng.skor * 0.30).toFixed(2));
    const kontribusiTanah = Number((pedologi.skor * 0.25).toFixed(2));
    const kontribusiBatuan = Number((litologi.skor * 0.20).toFixed(2));
    const kontribusiHujan = Number((hujan.skor * 0.15).toFixed(2));
    const kontribusiLahan = Number((tutupan.skor * 0.10).toFixed(2));

    const skorAkhir = Number(
      (kontribusiLereng + kontribusiTanah + kontribusiBatuan + kontribusiHujan + kontribusiLahan).toFixed(2)
    );

    const fsInfo = hitungInfiniteSlopeFS(lereng.derajat, pedologi, hujan, tutupan);

    let kode = "hijau";
    let hex = TRIAGE_HEX.hijau;
    let namaZona = "Zona Hijau";
    let zonaKode = "ZONA HIJAU";
    let zonaTriase = "ZONA HIJAU (Datar / Risiko Rendah / Konstruksi Standar)";

    if (skorAkhir > 3.40) {
      kode = "merah";
      hex = TRIAGE_HEX.merah;
      namaZona = "Zona Merah";
      zonaKode = "ZONA MERAH";
      zonaTriase = "ZONA MERAH (Risiko Tinggi / Rawan Longsor / Non-Buildable)";
    } else if (skorAkhir >= 2.20) {
      kode = "kuning";
      hex = TRIAGE_HEX.kuning;
      namaZona = "Zona Kuning";
      zonaKode = "ZONA KUNING";
      zonaTriase = "ZONA KUNING (Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud)";
    }

    return {
      kode,
      hex,
      namaZona,
      zonaKode,
      zonaTriase,
      badge: `SKOR ${skorAkhir.toFixed(2)} — ${zonaKode}`,
      skorAkhir,
      kontribusi: {
        lereng: kontribusiLereng,
        tanah: kontribusiTanah,
        batuan: kontribusiBatuan,
        hujan: kontribusiHujan,
        lahan: kontribusiLahan,
      },
      fsInfo,
    };
  }

  // =========================================================================
  // 5. REKOMENDASI REKAYASA GEOTEKNIK
  // =========================================================================
  function buatRekomendasiGeoteknik(info) {
    const deg = info.lereng.derajat;
    const pct = info.lereng.persen;
    const tanah = info.pedologi;
    const batuan = info.litologi;
    const hujan = info.hujan;
    const triase = info.triase;
    const fsInfo = triase.fsInfo;

    let diagnosa = "";
    if (triase.kode === "merah") {
      diagnosa = `Skor GPKG <b>${formatAngka(triase.skorAkhir, 2)} (ZONA MERAH)</b> pada kemiringan <b>${formatAngka(deg, 2)}° (${formatAngka(pct, 1)}%)</b> dengan formasi <b>${batuan.nama}</b>, tanah <b>${tanah.nama}</b>, dan curah hujan tahunan <b>${formatAngka(hujan.chMm, 0)} mm/thn</b> (tekanan pori u = <b>${formatAngka(fsInfo.uKpa, 2)} kPa</b>) menunjukkan kerentanan geoteknik tinggi dengan <b>FS = ${formatAngka(fsInfo.fs, 2)} (${fsInfo.status})</b>.`;
    } else if (tanah.isExpansive) {
      diagnosa = `Tanah <b>${tanah.nama}</b> (c'=${tanah.cPrime} kPa, φ'=${tanah.phiPrime}°) memiliki potensi kembang-susut tinggi pada curah hujan <b>${formatAngka(hujan.chMm, 0)} mm/thn</b>. Meskipun kemiringan lereng <b>${formatAngka(deg, 2)}°</b> menghasilkan <b>FS = ${formatAngka(fsInfo.fs, 2)}</b>, pergerakan vertikal lempung ekspansif wajib dimitigasi.`;
    } else if (triase.kode === "kuning") {
      diagnosa = `Skor GPKG <b>${formatAngka(triase.skorAkhir, 2)} (ZONA KUNING)</b> dengan kemiringan lereng <b>${formatAngka(deg, 2)}° (${formatAngka(pct, 1)}%)</b>, tanah <b>${tanah.nama}</b>, dan batuan <b>${batuan.nama}</b> menghasilkan <b>FS = ${formatAngka(fsInfo.fs, 2)} (${fsInfo.status})</b>. Diperlukan pengendalian infiltrasi air hujan dan perkuatan tebing/pondasi.`;
    } else {
      diagnosa = `Skor GPKG <b>${formatAngka(triase.skorAkhir, 2)} (ZONA HIJAU)</b> pada kemiringan <b>${formatAngka(deg, 2)}° (${formatAngka(pct, 1)}%)</b> dengan tanah <b>${tanah.nama}</b> dan formasi <b>${batuan.nama}</b> menunjukkan stabilitas mekanika tanah yang baik (<b>FS = ${formatAngka(fsInfo.fs, 2)} — ${fsInfo.status}</b>).`;
    }

    let fondasi = "";
    if (tanah.isExpansive) {
      fondasi = `Gunakan pondasi dalam <b>Strauss Pile / Bore Pile</b> (kedalaman &gt; ${tanah.zDepth} m menembus zona aktif lempung smektit) dengan <b>sloof beton bertulang kaku (rigid grade beam)</b> dan lapisan urugan pengganti non-ekspansif.`;
    } else if (triase.kode === "merah" || fsInfo.fs < 1.07 || deg > 25.0) {
      fondasi = `Zona Non-Buildable untuk konstruksi standar. Wajib investigasi <b>Sondir (CPT) &amp; Core Drilling SPT</b> serta pondasi <b>Bore Pile tertanam pada batuan dasar (bedrock socketed)</b>.`;
    } else if (triase.kode === "kuning" || deg > 8.0) {
      fondasi = `Gunakan pondasi <b>Telapak Beton Bertulang (Footplat)</b> dikombinasikan dengan <b>Strauss Pile</b> kedalaman ${formatAngka(tanah.zDepth, 1)}–3,0 m dan balok pengikat (tie beam) kaku.`;
    } else {
      fondasi = `Dapat menggunakan <b>pondasi dangkal menerus batu kali</b> (1 lantai) atau <b>Footplat beton bertulang</b> (2 lantai) pada kedalaman 0,8–1,2 m dengan pemadatan tanah dasar standar.`;
    }

    let mitigasi = "";
    if (triase.kode === "merah" || fsInfo.fs < 1.07) {
      mitigasi = `Hindari pemotongan lereng tegak. Wajib rekayasa <b>Dinding Penahan Tanah (DPT) Kantilever / Bronjong Berjenjang</b>, drainase pengelak puncak lereng (interceptor drain), dan pipa suling-suling (weep hole) berlapis geotekstil.`;
    } else if (triase.kode === "kuning" || fsInfo.fs <= 1.25) {
      mitigasi = `Bangun <b>talud pasangan batu / retaining wall</b> pada beda kontur &gt; 1,2 m dilengkapi weep hole, saluran drainase U-Ditch kedap air untuk menekan rasio kejenuhan (m = ${formatAngka(fsInfo.mRatio, 2)}), dan penataan kavling terasering.`;
    } else {
      mitigasi = `Pematangan lahan dengan metode <b>cut-and-fill standar</b>, saluran drainase lingkungan tertutup/U-Ditch, serta sumur resapan air hujan sesuai standar teknis permukiman.`;
    }

    let statusKpr = "ZONA HIJAU — Layak Konstruksi Standar";
    let descKpr = "Memenuhi syarat kelayakan teknis pembangunan perumahan standar dengan risiko geoteknik rendah.";
    if (triase.kode === "kuning") {
      statusKpr = "ZONA KUNING — Layak Bersyarat (Wajib Mitigasi Drainase & Pondasi Khusus/Talud)";
      descKpr = "Dapat dikembangkan untuk perumahan dengan syarat rekayasa drainase kedap, perkuatan talud, dan penyesuaian desain pondasi.";
    } else if (triase.kode === "merah") {
      statusKpr = "ZONA MERAH — Risiko Tinggi / Rawan Longsor / Non-Buildable";
      descKpr = "Tidak direkomendasikan untuk kavling perumahan reguler tanpa penyelidikan geoteknik mendalam dan struktur penahan lereng berat.";
    }

    return { diagnosa, fondasi, mitigasi, statusKpr, descKpr };
  }

  // =========================================================================
  // 6. ENGINE GEOMETRI POINT-IN-POLYGON & SPATIAL QUERY
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

  function cariKalurahanPadaTitik(easting, northing, lng, lat) {
    const exactFeat = cariFiturPoligonPadaTitik(easting, northing, state.adminFeatures, lng, lat);
    if (exactFeat) return exactFeat;
    return state.adminFeatures.length ? state.adminFeatures[0] : null;
  }

  /**
   * Ekstraksi Spasial Multi-Layer Murni Data-Driven (Tanpa Dummy β=4.5° dan Tanpa Dusun)
   */
  function analisisSpasialTitik(rawProps, latlngKlik) {
    const wgsLatLng = latlngKlik || L.latLng(-7.765, 110.378);
    const utmKlik = latLngToUtm49s(wgsLatLng);
    const easting = Number(utmKlik.easting) || 435865;
    const northing = Number(utmKlik.northing) || 9146908;

    const adminFeat = cariKalurahanPadaTitik(easting, northing, wgsLatLng.lng, wgsLatLng.lat);
    const adminProps = (adminFeat && adminFeat.properties) || {};
    const mergedProps = Object.assign({}, adminProps, rawProps || {});

    const slopePolyFeat = cariFiturPoligonPadaTitik(easting, northing, state.lerengFeatures, wgsLatLng.lng, wgsLatLng.lat);
    const hujanPolyFeat = cariFiturPoligonPadaTitik(easting, northing, state.hujanFeatures, wgsLatLng.lng, wgsLatLng.lat);
    const geologiPolyFeat = cariFiturPoligonPadaTitik(easting, northing, state.geologiFeatures, wgsLatLng.lng, wgsLatLng.lat);
    const tanahPolyFeat = cariFiturPoligonPadaTitik(easting, northing, state.tanahFeatures, wgsLatLng.lng, wgsLatLng.lat);
    const tutupanPolyFeat = cariFiturPoligonPadaTitik(easting, northing, state.tutupanFeatures, wgsLatLng.lng, wgsLatLng.lat);
    const kerawananPolyFeat = cariFiturPoligonPadaTitik(easting, northing, state.kerawananFeatures, wgsLatLng.lng, wgsLatLng.lat);

    const krProps = (kerawananPolyFeat && kerawananPolyFeat.properties) || {};
    const slProps = (slopePolyFeat && slopePolyFeat.properties) || {};
    const tnProps = (tanahPolyFeat && tanahPolyFeat.properties) || {};
    const geoProps = (geologiPolyFeat && geologiPolyFeat.properties) || {};
    const hjProps = (hujanPolyFeat && hujanPolyFeat.properties) || {};
    const tuProps = (tutupanPolyFeat && tutupanPolyFeat.properties) || {};

    // 1. Kemiringan Lereng (β) murni dari poligon kerawanan / DEMNAS / lereng
    const lerengDerajat =
      krProps.lereng_derajat ??
      mergedProps.lereng_derajat ??
      slProps.lereng_derajat ??
      adminProps.lereng_derajat ??
      2.5;
    const lerengPersen =
      krProps.lereng_persen ??
      mergedProps.lereng_persen ??
      slProps.lereng_persen ??
      adminProps.lereng_persen;

    const lereng = evaluasiKemiringanLereng(lerengDerajat, lerengPersen);
    const sPolyLereng = Number(slProps.skor_lereng || krProps.skor_lereng);
    if (sPolyLereng >= 1 && sPolyLereng <= 5) {
      lereng.skor = sPolyLereng;
    }

    // 2. Karakteristik Tanah (Pedologi) berbasis Dasar.xlsx
    const jenisTanahStr =
      tnProps.jenis_tanah ||
      tnProps.jns_tnh ||
      krProps.ket_tanah ||
      mergedProps.jenis_tanah ||
      adminProps.jenis_tanah ||
      "Regosol";
    const pedologi = evaluasiPedologiTanah(jenisTanahStr);
    if (Number(tnProps.skor_tanah || krProps.skor_tanah) >= 1) {
      pedologi.skor = Number(tnProps.skor_tanah || krProps.skor_tanah);
    }
    if (Number(tnProps.c_kpa || krProps.c_kpa) > 0) {
      pedologi.cPrime = Number(tnProps.c_kpa || krProps.c_kpa);
    }
    if (Number(tnProps.phi_deg || krProps.phi_deg) > 0) {
      pedologi.phiPrime = Number(tnProps.phi_deg || krProps.phi_deg);
    }
    if (Number(tnProps.gamma_sat || krProps.gamma_sat) > 0) {
      pedologi.gammaSat = Number(tnProps.gamma_sat || krProps.gamma_sat);
    }
    if (Number(tnProps.z_depth || krProps.z_depth) > 0) {
      pedologi.zDepth = Number(tnProps.z_depth || krProps.z_depth);
    }

    // 3. Litologi & Formasi Geologi berbasis Dasar.xlsx
    const formasiStr =
      geoProps.formasi_batuan ||
      (geoProps.NAME ? `${geoProps.NAME} (${geoProps.SYMBOLS || ""})` : "") ||
      krProps.ket_batuan ||
      mergedProps.formasi_batuan ||
      adminProps.formasi_batuan ||
      "Endapan Vulkanik Merapi Muda (Qmi)";
    const litologi = evaluasiLitologiGeologi(formasiStr, geoProps.ket_batuan || "");
    if (Number(geoProps.skor_batuan || krProps.skor_batuan) >= 1) {
      litologi.skor = Number(geoProps.skor_batuan || krProps.skor_batuan);
    }

    // 4. Curah Hujan Tahunan (Isohyet) berbasis Dasar.xlsx
    const chMmVal =
      hjProps.curah_hujan_mm ??
      krProps.curah_hujan_mm ??
      mergedProps.curah_hujan_mm ??
      adminProps.curah_hujan_mm ??
      2250;
    const skorHujanOvr = hjProps.skor_hujan ?? krProps.skor_hujan ?? mergedProps.skor_hujan;
    const rasioMOvr = hjProps.rasio_m ?? krProps.rasio_m ?? mergedProps.rasio_m;
    const hujan = evaluasiCurahHujanTahunan(chMmVal, skorHujanOvr, rasioMOvr);

    // 5. Tutupan Lahan berbasis Dasar.xlsx
    const tutupanStr =
      tuProps.tutupan_lahan ||
      tuProps.klasifikasi ||
      krProps.ket_lahan ||
      mergedProps.tutupan_dominan ||
      adminProps.tutupan_dominan ||
      "Permukiman";
    const tutupan = evaluasiTutupanLahan(tutupanStr, lereng.derajat);
    if (Number(tuProps.skor_lahan || krProps.skor_lahan) >= 1) {
      tutupan.skor = Number(tuProps.skor_lahan || krProps.skor_lahan);
    }
    if (tuProps.cr_kpa !== undefined) tutupan.crKpa = Number(tuProps.cr_kpa);
    else if (krProps.cr_kpa !== undefined) tutupan.crKpa = Number(krProps.cr_kpa);
    if (tuProps.q_kpa !== undefined) tutupan.qKpa = Number(tuProps.q_kpa);
    else if (krProps.q_kpa !== undefined) tutupan.qKpa = Number(krProps.q_kpa);

    const triase = evaluasiZonaGPKG(lereng, pedologi, litologi, hujan, tutupan);

    const kalurahan = mergedProps.kalurahan || adminProps.kalurahan || "-";
    const kapanewon = mergedProps.kapanewon || adminProps.kapanewon || "-";
    const kabupaten = mergedProps.kabupaten || adminProps.kabupaten || "Kab. Sleman";
    const labelWilayah = `Kal. ${kalurahan}, Kapanewon ${kapanewon}, ${kabupaten}`;

    const info = {
      labelWilayah,
      kalurahan,
      kapanewon,
      kabupaten,
      easting,
      northing,
      latWgs84: wgsLatLng.lat,
      lonWgs84: wgsLatLng.lng,
      elevasiMdpl: mergedProps.elevasi_mdpl ?? adminProps.elevasi_mdpl ?? 115,
      lereng,
      pedologi,
      litologi,
      hujan,
      tutupan,
      triase,
      adminProps,
      adminFeat,
    };

    info.aiAdvisor = buatRekomendasiGeoteknik(info);
    return info;
  }

  // =========================================================================
  // 7. STYLING LAYER SPASIAL & OPACITY DINAMIS
  // =========================================================================
  function apakahFiturLolosFilter(props) {
    if (state.filterKab && props.kabupaten !== state.filterKab) return false;
    if (state.filterKap && props.kapanewon !== state.filterKap) return false;
    if (state.filterKal && props.kalurahan !== state.filterKal) return false;
    if (state.filterZona !== "ALL" && props._gpkgZonaNama !== state.filterZona) return false;
    return true;
  }

  function styleBatasAdmin(feature) {
    const p = feature.properties || {};
    const isSelected =
      state.selectedFeature &&
      state.selectedFeature.kalurahan === p.kalurahan &&
      state.selectedFeature.kapanewon === p.kapanewon &&
      state.selectedFeature.kabupaten === p.kabupaten;

    if (isSelected) {
      const hex = state.selectedTriageHex || p._gpkgHex || TRIAGE_HEX.hijau;
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
        color: "#e2e8f0",
        weight: 1.2,
        opacity: state.layerOpacities.admin ?? 0.75,
        fillColor: p._gpkgHex || TRIAGE_HEX.hijau,
        fillOpacity: 0.0,
      };
    }

    return {
      color: "transparent",
      weight: 0,
      opacity: 0,
      fillColor: "transparent",
      fillOpacity: 0,
    };
  }

  function renderSorotanTitikPadaPeta(info) {
    state.inspectHighlightGroup.clearLayers();
    const hex = info.triase.hex;
    const centerLatLng = L.latLng(info.latWgs84, info.lonWgs84);

    L.circle(centerLatLng, {
      radius: 260,
      color: hex,
      weight: 2.2,
      dashArray: "5,4",
      fillColor: hex,
      fillOpacity: 0.24,
      interactive: false,
    }).addTo(state.inspectHighlightGroup);

    L.circleMarker(centerLatLng, {
      radius: 8.0,
      fillColor: hex,
      color: "#ffffff",
      weight: 2.8,
      fillOpacity: 1.0,
    }).addTo(state.inspectHighlightGroup);
  }

  // =========================================================================
  // 8. FILTER ADMINISTRASI HIERARKIS (MODUL 3) + TURF.BBOX AUTO-ZOOM
  // =========================================================================
  function getFeatureLatLngCentroid(feature) {
    try {
      if (typeof turf !== "undefined" && feature && feature.geometry) {
        const b = turf.bbox(feature); // [minX, minY, maxX, maxY]
        const cx = (b[0] + b[2]) / 2;
        const cy = (b[1] + b[3]) / 2;
        return utm49sToLatLng([cx, cy]);
      }
    } catch (_e) {
      // fallback
    }
    return L.latLng(-7.765, 110.378);
  }

  function zoomKeFiturKalurahan(feature) {
    if (!feature || !feature.geometry) return;
    try {
      if (typeof turf !== "undefined") {
        const bbox = turf.bbox(feature); // [minX, minY, maxX, maxY]
        const sw = utm49sToLatLng([bbox[0], bbox[1]]);
        const ne = utm49sToLatLng([bbox[2], bbox[3]]);
        map.fitBounds(
          [
            [sw.lat, sw.lng],
            [ne.lat, ne.lng],
          ],
          { padding: [36, 36], maxZoom: 15, animate: true }
        );
        return;
      }
    } catch (_err) {
      // fallback ke L.geoJSON bounds
    }
    const tempLayer = buatLayerGeoJsonUTM(feature);
    const bounds = tempLayer.getBounds();
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15, animate: true });
    }
  }

  function inisialisasiFilterHierarkis() {
    const selKab = document.getElementById("select-kabupaten");
    const selKap = document.getElementById("select-kapanewon");
    const selKal = document.getElementById("select-kalurahan");
    const selZona = document.getElementById("filter-zona");
    const btnResetFilter = document.getElementById("btn-reset-admin-filter");

    if (!selKab || !selKap || !selKal) return;

    // 1. Populasi daftar Kabupaten/Kota dari clean_batas_administrasi.geojson
    const kabSet = new Set();
    for (const f of state.adminFeatures) {
      const kab = (f.properties && f.properties.kabupaten) || "";
      if (kab) kabSet.add(kab);
    }
    const kabList = Array.from(kabSet).sort((a, b) => a.localeCompare(b, "id"));
    selKab.innerHTML = `<option value="">-- Semua Kabupaten/Kota (DIY) --</option>` +
      kabList.map((k) => `<option value="${k}">${k}</option>`).join("");

    function updateDropdownKapanewon() {
      const kabVal = selKab.value;
      const kapSet = new Set();
      for (const f of state.adminFeatures) {
        const p = f.properties || {};
        if (kabVal && p.kabupaten !== kabVal) continue;
        if (p.kapanewon) kapSet.add(p.kapanewon);
      }
      const kapList = Array.from(kapSet).sort((a, b) => a.localeCompare(b, "id"));
      selKap.innerHTML = `<option value="">-- Semua Kapanewon (${kapList.length}) --</option>` +
        kapList.map((k) => `<option value="${k}">${k}</option>`).join("");
      selKap.disabled = !kabVal;
    }

    function updateDropdownKalurahan() {
      const kabVal = selKab.value;
      const kapVal = selKap.value;
      const kalSet = new Set();
      for (const f of state.adminFeatures) {
        const p = f.properties || {};
        if (kabVal && p.kabupaten !== kabVal) continue;
        if (kapVal && p.kapanewon !== kapVal) continue;
        if (p.kalurahan) kalSet.add(p.kalurahan);
      }
      const kalList = Array.from(kalSet).sort((a, b) => a.localeCompare(b, "id"));
      selKal.innerHTML = `<option value="">-- Pilih Kalurahan (${kalList.length}) --</option>` +
        kalList.map((k) => `<option value="${k}">${k}</option>`).join("");
      selKal.disabled = !kapVal;
    }

    selKab.addEventListener("change", () => {
      state.filterKab = selKab.value;
      state.filterKap = "";
      state.filterKal = "";
      updateDropdownKapanewon();
      selKal.innerHTML = `<option value="">-- Pilih Kalurahan (Auto Zoom) --</option>`;
      selKal.disabled = true;
      updateBannerWilayahTerpilih(null);
      if (state.layers.admin) state.layers.admin.setStyle(styleBatasAdmin);
      renderDaftarKalurahanTerfilter();
    });

    selKap.addEventListener("change", () => {
      state.filterKap = selKap.value;
      state.filterKal = "";
      updateDropdownKalurahan();
      updateBannerWilayahTerpilih(null);
      if (state.layers.admin) state.layers.admin.setStyle(styleBatasAdmin);
      renderDaftarKalurahanTerfilter();
    });

    selKal.addEventListener("change", () => {
      state.filterKal = selKal.value;
      if (state.layers.admin) state.layers.admin.setStyle(styleBatasAdmin);
      renderDaftarKalurahanTerfilter();

      if (!state.filterKal) {
        updateBannerWilayahTerpilih(null);
        return;
      }

      const targetFeat = state.adminFeatures.find((f) => {
        const p = f.properties || {};
        return (
          (!state.filterKab || p.kabupaten === state.filterKab) &&
          (!state.filterKap || p.kapanewon === state.filterKap) &&
          p.kalurahan === state.filterKal
        );
      });

      if (targetFeat) {
        pilihFiturKalurahan(targetFeat);
      }
    });

    if (selZona) {
      selZona.addEventListener("change", (e) => {
        state.filterZona = e.target.value;
        if (state.layers.admin) state.layers.admin.setStyle(styleBatasAdmin);
        renderDaftarKalurahanTerfilter();
      });
    }

    if (btnResetFilter) {
      btnResetFilter.addEventListener("click", () => {
        selKab.value = "";
        selKap.innerHTML = `<option value="">-- Pilih Kapanewon --</option>`;
        selKap.disabled = true;
        selKal.innerHTML = `<option value="">-- Pilih Kalurahan (Auto Zoom) --</option>`;
        selKal.disabled = true;
        if (selZona) selZona.value = "ALL";
        state.filterKab = "";
        state.filterKap = "";
        state.filterKal = "";
        state.filterZona = "ALL";
        updateBannerWilayahTerpilih(null);
        if (state.layers.admin) state.layers.admin.setStyle(styleBatasAdmin);
        renderDaftarKalurahanTerfilter();
      });
    }

    renderDaftarKalurahanTerfilter();
  }

  function updateBannerWilayahTerpilih(feat) {
    const banner = document.getElementById("selected-admin-banner");
    if (!banner) return;
    if (!feat || !feat.properties) {
      banner.style.display = "none";
      banner.innerHTML = "";
      return;
    }
    const p = feat.properties;
    banner.style.display = "block";
    banner.innerHTML = `
      <div style="font-weight:800;color:#1e3a8a;">📍 Kal. ${p.kalurahan}, Kapanewon ${p.kapanewon}, ${p.kabupaten}</div>
      <div style="font-size:10px;color:#334155;margin-top:2px;">
        Skor GPKG: <b>${formatAngka(p._gpkgSkor, 2)}</b> (${p._gpkgZonaNama}) • Lereng DEMNAS: <b>${formatAngka(p.lereng_derajat, 2)}°</b>
      </div>
    `;
  }

  function pilihFiturKalurahan(feat) {
    if (!feat || !feat.properties) return;
    updateBannerWilayahTerpilih(feat);
    zoomKeFiturKalurahan(feat);
    const centroidLatLng = getFeatureLatLngCentroid(feat);
    inspeksiTitikPeta(centroidLatLng, feat.properties);
  }

  function renderDaftarKalurahanTerfilter() {
    const container = document.getElementById("admin-filter-list");
    const badgeEl = document.getElementById("filter-count-badge");
    if (!container) return;

    const filtered = state.adminFeatures.filter((f) => apakahFiturLolosFilter(f.properties || {}));
    if (badgeEl) {
      badgeEl.textContent = `${filtered.length} Kalurahan`;
    }

    const tampil = filtered.slice(0, 40);
    if (!tampil.length) {
      container.innerHTML = `
        <div style="padding:10px;font-size:11px;color:#64748b;text-align:center;">
          Tidak ada Kalurahan yang cocok dengan filter saat ini.
        </div>
      `;
      return;
    }

    container.innerHTML = tampil
      .map((f, idx) => {
        const p = f.properties || {};
        const label = `Kal. ${p.kalurahan}, Kapanewon ${p.kapanewon}, ${p.kabupaten}`;
        const zHex = p._gpkgHex || TRIAGE_HEX.hijau;
        const zNama = (p._gpkgZonaNama || "Zona Hijau").replace("Zona ", "");
        return `
          <div class="search-item" data-idx="${idx}">
            <div style="min-width:0;flex:1;">
              <div style="font-weight:700;color:#0f172a;line-height:1.35;">
                <span class="place-type-badge desa">KALURAHAN</span>Kal. ${p.kalurahan}
              </div>
              <div style="font-size:10.5px;color:#64748b;margin-top:2px;line-height:1.35;">
                ${label} • Lereng ${formatAngka(p.lereng_derajat, 2)}°
              </div>
            </div>
            <span style="font-weight:800;font-size:10.5px;color:${zHex};flex-shrink:0;">
              ${zNama} (${formatAngka(p._gpkgSkor, 2)})
            </span>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll(".search-item").forEach((el, idx) => {
      el.addEventListener("click", () => {
        const feat = tampil[idx];
        if (!feat) return;
        const p = feat.properties || {};

        // Sinkronkan dropdown bertingkat
        const selKab = document.getElementById("select-kabupaten");
        const selKap = document.getElementById("select-kapanewon");
        const selKal = document.getElementById("select-kalurahan");
        if (selKab && p.kabupaten) {
          selKab.value = p.kabupaten;
          state.filterKab = p.kabupaten;
          selKab.dispatchEvent(new Event("change"));
        }
        if (selKap && p.kapanewon) {
          selKap.value = p.kapanewon;
          state.filterKap = p.kapanewon;
          selKap.dispatchEvent(new Event("change"));
        }
        if (selKal && p.kalurahan) {
          selKal.value = p.kalurahan;
          state.filterKal = p.kalurahan;
        }
        pilihFiturKalurahan(feat);
      });
    });
  }

  // =========================================================================
  // 9. SIDEBAR KANAN (380PX): DETAIL GEOTEKNIK, AUDIT TRAIL & 5 PROGRESS BARS
  // =========================================================================
  function renderEmptyStateSidebar() {
    const panel = document.getElementById("inspector-panel");
    if (!panel) return;
    panel.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">🧭</div>
        <h2 style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:6px;">
          Siap Menginspeksi Wilayah &amp; Geoteknik
        </h2>
        <p style="font-size:12px;color:#475569;line-height:1.5;margin-bottom:12px;">
          Klik sembarang titik di peta, pilih <b>Kabupaten &rarr; Kapanewon &rarr; Kalurahan</b> pada panel kiri, atau gunakan <b>Gambar Poligon Kavling</b> untuk mengekstrak parameter mekanika tanah (<b>Dasar.xlsx</b>), Faktor Keamanan Lereng (<b>Infinite Slope FS</b>), dan Audit Trail Geoteknik.
        </p>
        <div style="margin-bottom:10px;">
          <button type="button" class="btn btn-draw-kavling" id="btn-empty-draw-kavling" style="width:100%;justify-content:center;padding:8px 12px;">
            ✏️ Gambar Poligon Kavling (Analisis Segmen)
          </button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;">
          <button type="button" class="btn quick-sample-btn" data-lat="-7.5994" data-lon="110.4478">
            🌋 Kal. Umbulharjo, Cangkringan
          </button>
          <button type="button" class="btn quick-sample-btn" data-lat="-7.7167" data-lon="110.4186">
            🏡 Kal. Wedomartani, Ngemplak
          </button>
          <button type="button" class="btn quick-sample-btn" data-lat="-7.9408" data-lon="110.4247">
            ⛰️ Kal. Mangunan, Dlingo
          </button>
        </div>
      </div>
    `;

    panel.querySelectorAll(".quick-sample-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lat = parseFloat(btn.getAttribute("data-lat"));
        const lon = parseFloat(btn.getAttribute("data-lon"));
        inspeksiTitikPeta(L.latLng(lat, lon), null);
        map.flyTo([lat, lon], 14.0, { duration: 0.8 });
      });
    });

    const btnEmptyDraw = document.getElementById("btn-empty-draw-kavling");
    if (btnEmptyDraw) {
      btnEmptyDraw.addEventListener("click", () => {
        aktifkanModeGambarKavling();
      });
    }
  }

  function renderInspektor(info) {
    const panel = document.getElementById("inspector-panel");
    if (!panel) return;

    const { triase, lereng, pedologi, litologi, hujan, tutupan, aiAdvisor } = info;
    const fsInfo = triase.fsInfo;

    const fsBarPct = Math.min(100, Math.max(8, (fsInfo.fs / 5.0) * 100));
    const fsColor = fsInfo.warnaHex;
    const skorAkhirVal = Number(triase.skorAkhir || 2.0);
    const labelWilayah = `Kal. ${info.kalurahan}, Kapanewon ${info.kapanewon}, ${info.kabupaten}`;

    // 5 Progress Bar Breakdown Skor GPKG
    const breakdownItems = [
      {
        title: "1. Kemiringan Lereng (β)",
        bobot: "30%",
        skor: lereng.skor,
        kontribusi: (lereng.skor * 0.30).toFixed(2),
        maxKontribusi: "1,50",
        pct: (lereng.skor / 5) * 100,
        color: SCORE_COLORS[lereng.skor] || "#2E7D32",
        desc: `${formatAngka(lereng.derajat, 2)}° (${formatAngka(lereng.persen, 1)}%) — ${lereng.deskripsi}`,
      },
      {
        title: "2. Karakteristik Tanah (Pedologi)",
        bobot: "25%",
        skor: pedologi.skor,
        kontribusi: (pedologi.skor * 0.25).toFixed(2),
        maxKontribusi: "1,25",
        pct: (pedologi.skor / 5) * 100,
        color: SCORE_COLORS[pedologi.skor] || "#FFB300",
        desc: `${pedologi.nama} — ${pedologi.sifatRingkas}`,
      },
      {
        title: "3. Litologi & Formasi Geologi",
        bobot: "20%",
        skor: litologi.skor,
        kontribusi: (litologi.skor * 0.20).toFixed(2),
        maxKontribusi: "1,00",
        pct: (litologi.skor / 5) * 100,
        color: SCORE_COLORS[litologi.skor] || "#66BB6A",
        desc: `${litologi.nama} — ${litologi.litologi}`,
      },
      {
        title: "4. Curah Hujan Tahunan (Isohyet)",
        bobot: "15%",
        skor: hujan.skor,
        kontribusi: (hujan.skor * 0.15).toFixed(2),
        maxKontribusi: "0,75",
        pct: (hujan.skor / 5) * 100,
        color: SCORE_COLORS[hujan.skor] || "#FFB300",
        desc: `${formatAngka(hujan.chMm, 0)} mm/tahun — ${hujan.kelas}`,
      },
      {
        title: "5. Tutupan Lahan",
        bobot: "10%",
        skor: tutupan.skor,
        kontribusi: (tutupan.skor * 0.10).toFixed(2),
        maxKontribusi: "0,50",
        pct: (tutupan.skor / 5) * 100,
        color: SCORE_COLORS[tutupan.skor] || "#FFB300",
        desc: `${tutupan.kategori}`,
      },
    ];

    const breakdownHtml = breakdownItems
      .map(
        (b) => `
        <div class="score-progress-row">
          <div class="score-progress-header">
            <span class="score-progress-title">${b.title} <span style="color:#64748b;font-weight:600;">(Bobot ${b.bobot})</span></span>
            <span class="score-progress-badge" style="background:${b.color};color:#fff;">Skor ${b.skor}/5 (+${b.kontribusi.replace(".", ",")})</span>
          </div>
          <div class="score-progress-track">
            <div class="score-progress-fill" style="width:${b.pct}%;background:${b.color};"></div>
          </div>
          <div class="score-progress-desc">${b.desc}</div>
        </div>
      `
      )
      .join("");

    panel.innerHTML = `
      <!-- 1. CARD UTAMA: SKOR AKHIR GPKG & FAKTOR KEAMANAN LERENG (FS) -->
      <div class="triage-hero-card ${triase.kode}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="triage-badge-pill ${triase.kode}" style="background:${triase.hex};color:#fff;">
            SKOR GPKG: ${formatAngka(skorAkhirVal, 2)} / 5,00
          </span>
          <span style="font-size:10.5px;font-weight:700;opacity:0.88;">Elevasi ±${formatAngka(info.elevasiMdpl, 1)} mdpl</span>
        </div>

        <div style="margin-top:3px;font-size:11.5px;font-weight:800;color:#0f172a;">
          ${triase.zonaTriase}
        </div>

        <div>
          <div class="region-dusun-title" id="sidebar-wilayah-title">${labelWilayah}</div>
          <div class="region-hierarchy-sub">
            Permen PU No. 22/PRT/M/2007 &amp; SNI 8291:2016 • Matriks Empiris Dasar.xlsx
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

      <!-- CARD FAKTOR KEAMANAN (INFINITE SLOPE FS) -->
      <div class="fs-indicator-card">
        <div class="section-title" style="margin-bottom:6px;">
          <span>🛡️ Faktor Keamanan Lereng (Infinite Slope FS)</span>
          <span class="badge-count">Maks. 5,00</span>
        </div>
        <div class="fs-header-row">
          <div>
            <span style="font-size:10.5px;color:#64748b;display:block;">
              FS &gt; 1,25 Stabil | 1,07–1,25 Kritis | &lt; 1,07 Labil
            </span>
            <span class="fs-value-num" style="color:${fsColor};">FS = ${formatAngka(fsInfo.fs, 2)}</span>
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

      <!-- 2. PANEL AUDIT TRAIL PARAMETER MEKANIKA TANAH AKTUAL (MODUL 4) -->
      <div class="section-card">
        <div class="section-title">
          <span>🔬 Audit Trail Parameter Geoteknik</span>
          <span class="badge-count">Dasar.xlsx</span>
        </div>
        <div class="audit-trail-grid">
          <div class="audit-cell">
            <span class="audit-lbl">Kemiringan Lereng (&beta;)</span>
            <span class="audit-val">${formatAngka(lereng.derajat, 2)}&deg; (${formatAngka(lereng.persen, 1)}%)</span>
            <span class="audit-sub">DEMNAS / Poligon Lereng</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Kohesi Efektif (c' + c<sub>r</sub>)</span>
            <span class="audit-val">${formatAngka(fsInfo.cPrime, 1)} + ${formatAngka(fsInfo.crKpa, 1)} kPa</span>
            <span class="audit-sub">Tanah c' &amp; Kohesi Akar c<sub>r</sub></span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Sudut Geser Dalam (&phi;')</span>
            <span class="audit-val">${formatAngka(fsInfo.phiPrime, 1)}&deg;</span>
            <span class="audit-sub">${pedologi.nama}</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Berat Isi Jenuh (&gamma;<sub>sat</sub>)</span>
            <span class="audit-val">${formatAngka(fsInfo.gammaSat, 1)} kN/m&sup3;</span>
            <span class="audit-sub">&gamma;<sub>w</sub> = 9,81 kN/m&sup3;</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Kedalaman Gelincir (z)</span>
            <span class="audit-val">${formatAngka(fsInfo.zDepth, 2)} m</span>
            <span class="audit-sub">Bidang kontak solum</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Rasio Kejenuhan Air (m)</span>
            <span class="audit-val">m = h<sub>w</sub>/z = ${formatAngka(fsInfo.mRatio, 2)}</span>
            <span class="audit-sub">CH: ${formatAngka(hujan.chMm, 0)} mm/thn</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Tegangan Air Pori (u)</span>
            <span class="audit-val">${formatAngka(fsInfo.uKpa, 2)} kPa</span>
            <span class="audit-sub">u = m &middot; &gamma;<sub>w</sub> &middot; z</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Beban Tambahan (q)</span>
            <span class="audit-val">${formatAngka(fsInfo.qKpa, 1)} kPa</span>
            <span class="audit-sub">Surcharge: ${tutupan.nama}</span>
          </div>
        </div>
      </div>

      <!-- 3. BREAKDOWN SKOR 5 PROGRESS BAR BOBOT TERPISAH (MODUL 4) -->
      <div class="section-card">
        <div class="section-title">
          <span>📊 Breakdown 5 Parameter Skoring GPKG</span>
          <span class="badge-count">Total: ${formatAngka(skorAkhirVal, 2)}</span>
        </div>
        <div class="score-breakdown-list">
          ${breakdownHtml}
        </div>
      </div>

      <!-- 4. REKOMENDASI REKAYASA GEOTEKNIK & KELAYAKAN PERUMAHAN -->
      <div class="ai-advisor-card">
        <div class="ai-advisor-header">
          <div class="ai-advisor-title">
            <span>🏗️ Rekomendasi Rekayasa Geoteknik</span>
          </div>
          <span class="ai-badge">Engineering Advisory</span>
        </div>

        <div class="advisor-block diagnosa">
          <div class="advisor-block-title">⚠️ Diagnosa Mekanika Tanah &amp; Lereng</div>
          <div class="advisor-block-text">${aiAdvisor.diagnosa}</div>
        </div>

        <div class="advisor-block fondasi">
          <div class="advisor-block-title">🔩 Rekomendasi Struktur &amp; Pondasi</div>
          <div class="advisor-block-text">${aiAdvisor.fondasi}</div>
        </div>

        <div class="advisor-block mitigasi">
          <div class="advisor-block-title">🛠️ Mitigasi Drainase &amp; Perkuatan Lereng</div>
          <div class="advisor-block-text">${aiAdvisor.mitigasi}</div>
        </div>

        <div class="kpr-status-box ${triase.kode}">
          <div class="kpr-status-label">🏦 Status Kelayakan Pengembangan Perumahan</div>
          <div class="kpr-status-value">${aiAdvisor.statusKpr}</div>
          <div class="kpr-status-desc">${aiAdvisor.descKpr}</div>
        </div>
      </div>
    `;
  }

  function buatPopupRingkas(info) {
    const { triase, lereng, pedologi } = info;
    const labelWilayah = `Kal. ${info.kalurahan}, Kapanewon ${info.kapanewon}, ${info.kabupaten}`;
    return `
      <div style="min-width:255px;">
        <div style="margin-bottom:4px;">
          <span class="triage-badge-pill ${triase.kode}" style="font-size:9.5px;padding:2px 8px;background:${triase.hex};color:#fff;">
            ${triase.badge}
          </span>
        </div>
        <div class="popup-title">${labelWilayah}</div>
        <div class="popup-sub">Koordinat WGS84: ${info.latWgs84.toFixed(5)}°, ${info.lonWgs84.toFixed(5)}°</div>
        <div class="popup-grid">
          <div class="popup-cell">
            <span style="color:#64748b;font-size:10px;display:block;">Skor GPKG &amp; Lereng (&beta;)</span>
            <b>${formatAngka(triase.skorAkhir, 2)} | ${formatAngka(lereng.derajat, 2)}&deg; (${formatAngka(lereng.persen, 1)}%)</b>
          </div>
          <div class="popup-cell">
            <span style="color:#64748b;font-size:10px;display:block;">Infinite Slope FS</span>
            <b style="color:${triase.fsInfo.warnaHex};">FS = ${formatAngka(triase.fsInfo.fs, 2)} (${triase.fsInfo.status})</b>
          </div>
          <div class="popup-cell" style="grid-column:span 2;">
            <span style="color:#64748b;font-size:10px;display:block;">Parameter Tanah (Dasar.xlsx)</span>
            <b>${pedologi.nama} (c'=${pedologi.cPrime} kPa, &phi;'=${pedologi.phiPrime}&deg;, &gamma;<sub>sat</sub>=${pedologi.gammaSat} kN/m&sup3;)</b>
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 10. INSPEKSI KLIK PETA & SINKRONISASI BACKEND (/api/query)
  // =========================================================================
  async function inspeksiTitikPeta(latlng, rawPropsOverride) {
    if (!latlng) return;

    const utm = latLngToUtm49s(latlng);
    const inLat = document.getElementById("input-lat");
    const inLon = document.getElementById("input-lon");
    const inUtmX = document.getElementById("input-utm-x");
    const inUtmY = document.getElementById("input-utm-y");
    if (inLat) inLat.value = latlng.lat.toFixed(5);
    if (inLon) inLon.value = latlng.lng.toFixed(5);
    if (inUtmX) inUtmX.value = Math.round(utm.easting);
    if (inUtmY) inUtmY.value = Math.round(utm.northing);

    const info = analisisSpasialTitik(rawPropsOverride, latlng);

    state.selectedFeature = info.adminProps;
    state.selectedTriageHex = info.triase.hex;
    if (state.layers.admin) {
      state.layers.admin.setStyle(styleBatasAdmin);
    }

    renderSorotanTitikPadaPeta(info);
    renderInspektor(info);

    const popup = L.popup({ maxWidth: 320 })
      .setLatLng(latlng)
      .setContent(buatPopupRingkas(info))
      .openOn(map);

    try {
      const qs = new URLSearchParams({
        lat: latlng.lat.toFixed(5),
        lng: latlng.lng.toFixed(5),
      });
      const resp = await fetch(`/api/query?${qs.toString()}`);
      if (resp.ok) {
        const bData = await resp.json();
        if (bData && bData.status === "ok" && bData.wilayah && bData.triase) {
          info.kalurahan = bData.wilayah.kalurahan || info.kalurahan;
          info.kapanewon = bData.wilayah.kapanewon || info.kapanewon;
          info.kabupaten = bData.wilayah.kabupaten || info.kabupaten;
          info.labelWilayah = `Kal. ${info.kalurahan}, Kapanewon ${info.kapanewon}, ${info.kabupaten}`;
          info.elevasiMdpl = bData.wilayah.elevasi_mdpl ?? info.elevasiMdpl;

          if (bData.kondisi_lapangan) {
            const kl = bData.kondisi_lapangan;
            if (kl.lereng_derajat !== undefined) {
              const updLereng = evaluasiKemiringanLereng(kl.lereng_derajat, kl.lereng_persen);
              info.lereng.derajat = updLereng.derajat;
              info.lereng.persen = updLereng.persen;
              info.lereng.kelas = updLereng.kelas;
              info.lereng.deskripsi = updLereng.deskripsi;
              info.lereng.skor = updLereng.skor;
            }
            if (kl.jenis_tanah) {
              const updTanah = evaluasiPedologiTanah(kl.jenis_tanah);
              info.pedologi = Object.assign(info.pedologi, updTanah);
            }
            if (kl.c_kpa !== undefined) info.pedologi.cPrime = Number(kl.c_kpa);
            if (kl.phi_deg !== undefined) info.pedologi.phiPrime = Number(kl.phi_deg);
            if (kl.gamma_sat !== undefined) info.pedologi.gammaSat = Number(kl.gamma_sat);
            if (kl.z_depth !== undefined) info.pedologi.zDepth = Number(kl.z_depth);
            if (kl.cr_kpa !== undefined) info.tutupan.crKpa = Number(kl.cr_kpa);
            if (kl.q_kpa !== undefined) info.tutupan.qKpa = Number(kl.q_kpa);
            if (kl.curah_hujan_mm !== undefined) {
              info.hujan = evaluasiCurahHujanTahunan(kl.curah_hujan_mm, kl.skor_hujan, kl.rasio_m);
            }
          }

          if (bData.skor_internal) {
            const si = bData.skor_internal;
            if (si.skor_lereng) info.lereng.skor = Number(si.skor_lereng);
            if (si.skor_tanah) info.pedologi.skor = Number(si.skor_tanah);
            if (si.skor_batuan) info.litologi.skor = Number(si.skor_batuan);
            if (si.skor_hujan) info.hujan.skor = Number(si.skor_hujan);
            if (si.skor_lahan || si.skor_tutupan) info.tutupan.skor = Number(si.skor_lahan || si.skor_tutupan);
          }

          info.triase = evaluasiZonaGPKG(info.lereng, info.pedologi, info.litologi, info.hujan, info.tutupan);
          info.aiAdvisor = buatRekomendasiGeoteknik(info);

          state.selectedTriageHex = info.triase.hex;
          if (state.layers.admin) {
            state.layers.admin.setStyle(styleBatasAdmin);
          }
          renderSorotanTitikPadaPeta(info);
          renderInspektor(info);
          if (popup && popup.isOpen()) {
            popup.setContent(buatPopupRingkas(info));
          }
        }
      }
    } catch (_errBackend) {
      // Tetap gunakan kalkulasi lokal berbasis Dasar.xlsx bila offline
    }
  }

  function bersihkanPilihanPeta() {
    if (map.pm && map.pm.globalDrawModeEnabled()) {
      map.pm.disableDraw();
    }
    state.isDrawingKavling = false;
    state.activeKavlingResult = null;
    state.segmentLayersById = {};
    state.selectedFeature = null;
    state.inspectHighlightGroup.clearLayers();
    state.kavlingSegmentGroup.clearLayers();
    map.closePopup();
    if (state.layers.admin) {
      state.layers.admin.setStyle(styleBatasAdmin);
    }
    sinkronStatusTombolGambar(false, false);
    renderEmptyStateSidebar();
  }

  // =========================================================================
  // 11. PEMOTONGAN POLIGON KAVLING & SEGMENTASI GEOTEKNIK
  // =========================================================================
  const KAVLING_ZONE_STYLE = {
    Hijau: { fill: "#2E7D32", border: "#1B5E20", opacity: 0.58 },
    Kuning: { fill: "#FB8C00", border: "#E65100", opacity: 0.58 },
    Merah: { fill: "#D32F2F", border: "#B71C1C", opacity: 0.58 },
  };

  function tentukanGayaSegmen(props) {
    if (props && props.warna_hex && props.border_hex) {
      return { fill: props.warna_hex, border: props.border_hex, opacity: 0.58 };
    }
    const zText = String((props && (props.zona_triase || props.kategori_zona)) || "").toUpperCase();
    if (zText.includes("MERAH")) return KAVLING_ZONE_STYLE.Merah;
    if (zText.includes("KUNING")) return KAVLING_ZONE_STYLE.Kuning;
    return KAVLING_ZONE_STYLE.Hijau;
  }

  function sinkronStatusTombolGambar(isDrawing, hasResult) {
    const btnMain = document.getElementById("btn-draw-kavling");
    const btnTop = document.getElementById("btn-draw-kavling-top");
    const btnResetMap = document.getElementById("btn-reset-kavling-map");

    if (btnMain) {
      if (isDrawing) {
        btnMain.classList.add("drawing-active");
        btnMain.innerHTML = "<span>🛑 Batal Gambar Poligon</span>";
      } else {
        btnMain.classList.remove("drawing-active");
        btnMain.innerHTML = "<span>✏️ Gambar Poligon Kavling</span>";
      }
    }
    if (btnTop) {
      if (isDrawing) {
        btnTop.classList.add("active");
        btnTop.innerHTML = "🛑 Batal Gambar";
      } else {
        btnTop.classList.remove("active");
        btnTop.innerHTML = "✏️ Gambar Poligon Kavling";
      }
    }
    if (btnResetMap) {
      btnResetMap.style.display = hasResult ? "inline-flex" : "none";
    }
  }

  function aktifkanModeGambarKavling() {
    if (!map.pm) return;
    if (map.pm.globalDrawModeEnabled()) {
      map.pm.disableDraw();
      state.isDrawingKavling = false;
      sinkronStatusTombolGambar(false, Boolean(state.activeKavlingResult));
      setLoading(null);
      return;
    }
    map.closePopup();
    state.isDrawingKavling = true;
    sinkronStatusTombolGambar(true, Boolean(state.activeKavlingResult));
    setLoading("✏️ Klik titik-titik sudut poligon kavling di peta, lalu klik titik awal untuk menyelesaikan...");

    map.pm.enableDraw("Polygon", {
      snappable: true,
      snapDistance: 15,
      allowSelfIntersection: false,
      finishOn: "dblclick",
      templineStyle: { color: "#2563eb", weight: 2.5, dashArray: "5,5" },
      hintlineStyle: { color: "#2563eb", weight: 2, dashArray: "5,5" },
      pathOptions: {
        color: "#1d4ed8",
        fillColor: "#3b82f6",
        fillOpacity: 0.25,
        weight: 2.5,
      },
    });
  }

  function renderLoadingKavlingSidebar() {
    const panel = document.getElementById("inspector-panel");
    if (!panel) return;
    panel.innerHTML = `
      <div class="kavling-loading-card">
        <div class="kavling-spinner"></div>
        <div style="font-size:13.5px;font-weight:800;color:#0f172a;margin-bottom:5px;">
          Memproses Segmentasi Spasial Kavling...
        </div>
        <div style="font-size:11.5px;color:#475569;line-height:1.5;">
          Memotong geometri poligon terhadap zona kerawanan GPKG serta menghitung sudut kemiringan DEMNAS (<b>&beta;&deg;</b>) dan <b>Infinite Slope FS</b>.
        </div>
      </div>
    `;
  }

  function renderSegmenKavlingDiPeta(fcData) {
    state.kavlingSegmentGroup.clearLayers();
    state.segmentLayersById = {};

    const geojsonLayer = L.geoJSON(fcData, {
      style: (feature) => {
        const p = feature.properties || {};
        const st = tentukanGayaSegmen(p);
        return {
          color: st.border,
          weight: 2.4,
          opacity: 0.95,
          fillColor: st.fill,
          fillOpacity: 0.58,
        };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        const st = tentukanGayaSegmen(p);
        const segId = p.segmen_id || "SEG-01";
        const zonaLabel = p.zona_singkat || p.zona_triase || "Zona GPKG";

        state.segmentLayersById[segId] = layer;

        const tooltipHtml = `
          <div style="min-width:185px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
              <b style="font-size:12px;color:#fff;">${segId} — ${zonaLabel}</b>
              <span style="width:10px;height:10px;border-radius:50%;background:${st.fill};display:inline-block;"></span>
            </div>
            <div style="font-size:11px;line-height:1.45;color:#e2e8f0;">
              <div>📐 Luas Segmen: <b>${formatAngka(p.luas_m2, 1)} m²</b> (${formatAngka(p.persen_luas, 1)}%)</div>
              <div>⛰️ Sudut Lereng (&beta;): <b>${formatAngka(p.beta_mean, 2)}&deg;</b></div>
              <div>🛡️ Infinite Slope FS: <b>${formatAngka(p.fs, 2)} (${p.fs_label || "STABIL"})</b></div>
            </div>
          </div>
        `;

        layer.bindTooltip(tooltipHtml, {
          sticky: true,
          direction: "top",
          className: "kavling-seg-tooltip",
        });

        layer.on("mouseover", () => {
          layer.setStyle({ weight: 3.6, fillOpacity: 0.78 });
          if (layer.bringToFront) layer.bringToFront();
        });

        layer.on("mouseout", () => {
          layer.setStyle({
            color: st.border,
            weight: 2.4,
            fillColor: st.fill,
            fillOpacity: 0.58,
          });
        });
      },
    }).addTo(state.kavlingSegmentGroup);

    const bounds = geojsonLayer.getBounds();
    if (bounds && bounds.isValid()) {
      map.flyToBounds(bounds.pad(0.25), { duration: 0.75, maxZoom: 17 });
    }
  }

  function renderPanelSegmenKavling(fcData) {
    const panel = document.getElementById("inspector-panel");
    if (!panel) return;

    const features = fcData.features || [];
    const summary = fcData.summary || {};

    let totalLuas = Number(summary.total_luas_m2);
    if (!Number.isFinite(totalLuas) || totalLuas <= 0) {
      totalLuas = features.reduce((acc, f) => acc + Number((f.properties && f.properties.luas_m2) || 0), 0);
    }

    const betaKavling =
      summary.beta_mean_kavling !== undefined
        ? summary.beta_mean_kavling
        : totalLuas > 0
        ? features.reduce(
            (acc, f) => acc + Number(f.properties.beta_mean || 0) * Number(f.properties.luas_m2 || 0),
            0
          ) / totalLuas
        : 2.5;

    const propZona = summary.proporsi_zona || {
      Hijau: { luas_m2: 0, persen: 0 },
      Kuning: { luas_m2: 0, persen: 0 },
      Merah: { luas_m2: 0, persen: 0 },
    };

    const pctHijau = Number((propZona.Hijau && propZona.Hijau.persen) || 0);
    const pctKuning = Number((propZona.Kuning && propZona.Kuning.persen) || 0);
    const pctMerah = Number((propZona.Merah && propZona.Merah.persen) || 0);

    const rowsHtml = features
      .map((f) => {
        const p = f.properties || {};
        const kat = p.kategori_zona || "Hijau";
        const st = KAVLING_ZONE_STYLE[kat] || KAVLING_ZONE_STYLE.Hijau;
        const namaZona = p.zona_singkat || `Zona ${kat}`;

        return `
          <tr class="kavling-seg-row" data-seg-id="${p.segmen_id}">
            <td>
              <div style="font-weight:800;color:#0f172a;margin-bottom:2px;">${p.segmen_id}</div>
              <span class="seg-zone-badge ${kat}">
                <span style="width:7px;height:7px;border-radius:50%;background:${st.fill};display:inline-block;"></span>
                ${namaZona}
              </span>
            </td>
            <td class="seg-num-cell">${formatAngka(p.luas_m2, 1)}</td>
            <td class="seg-num-cell">${formatAngka(p.persen_luas, 1)}%</td>
            <td class="seg-num-cell">${formatAngka(p.beta_mean, 2)}&deg;</td>
            <td class="seg-num-cell">
              <div>FS ${formatAngka(p.fs, 2)}</div>
              <div style="font-size:9.5px;color:#64748b;font-weight:600;">${p.fs_label || "STABIL"}</div>
            </td>
          </tr>
        `;
      })
      .join("");

    panel.innerHTML = `
      <div class="kavling-hero-card">
        <div class="kavling-hero-top">
          <span class="kavling-phase-badge">📐 Hasil Segmentasi Kavling</span>
          <span style="font-size:10.5px;color:#94a3b8;font-family:'JetBrains Mono',monospace;">EPSG:32749</span>
        </div>

        <div class="kavling-total-area-box">
          <div>
            <div class="kavling-total-label">Total Luas Kavling</div>
            <div style="font-size:10.5px;color:#94a3b8;margin-top:2px;">
              &asymp; ${formatAngka(totalLuas / 10000, 3)} Ha &bull; ${features.length} Segmen Spasial
            </div>
          </div>
          <div class="kavling-total-value">${formatAngka(totalLuas, 1)} m&sup2;</div>
        </div>

        <div class="kavling-kpi-grid">
          <div class="kavling-kpi-item">
            <span class="kavling-kpi-lbl">Jumlah Segmen</span>
            <span class="kavling-kpi-val">${features.length} Zona</span>
          </div>
          <div class="kavling-kpi-item">
            <span class="kavling-kpi-lbl">Rerata Lereng (&beta;)</span>
            <span class="kavling-kpi-val">${formatAngka(betaKavling, 2)}&deg;</span>
          </div>
          <div class="kavling-kpi-item">
            <span class="kavling-kpi-lbl">Zona Dominan</span>
            <span class="kavling-kpi-val">${pctMerah >= pctKuning && pctMerah >= pctHijau ? "Merah" : pctKuning >= pctHijau ? "Kuning" : "Hijau"}</span>
          </div>
        </div>

        <div>
          <div class="kavling-stacked-bar" title="Proporsi Luas Kelas Skoring GPKG">
            <div class="kavling-stacked-seg" style="width:${pctHijau}%;background:#2E7D32;"></div>
            <div class="kavling-stacked-seg" style="width:${pctKuning}%;background:#FB8C00;"></div>
            <div class="kavling-stacked-seg" style="width:${pctMerah}%;background:#D32F2F;"></div>
          </div>
          <div class="kavling-zone-MiniLegend" style="margin-top:6px;">
            <span>🟢 Zona Hijau: <b>${formatAngka(pctHijau, 1)}%</b></span>
            <span>🟠 Zona Kuning: <b>${formatAngka(pctKuning, 1)}%</b></span>
            <span>🔴 Zona Merah: <b>${formatAngka(pctMerah, 1)}%</b></span>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-title">
          <span>📊 Tabel Matriks Segmen Kavling</span>
          <span class="badge-count">${features.length} Segmen</span>
        </div>

        <div class="segment-table-wrap">
          <table class="segment-matrix-table">
            <thead>
              <tr>
                <th>Segmen / Zona</th>
                <th style="text-align:right;">Luas (m&sup2;)</th>
                <th style="text-align:right;">Porsi (%)</th>
                <th style="text-align:right;">Lereng (&beta;&deg;)</th>
                <th style="text-align:right;">FS Lereng</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section-card">
        <div class="section-title">
          <span>🔬 Audit Trail Parameter Segmen (Dasar.xlsx)</span>
        </div>
        <div class="field-summary-list">
          ${features
            .map((f) => {
              const p = f.properties || {};
              return `
                <div class="field-row" style="padding:7px 9px;">
                  <div style="min-width:0;flex:1;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                      <span style="font-weight:800;font-size:11.5px;color:#0f172a;">${p.segmen_id} (${p.zona_singkat})</span>
                      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#334155;">
                        c'=${formatAngka(p.c_kpa, 1)} | &phi;'=${formatAngka(p.phi_deg, 1)}&deg; | m=${formatAngka(p.rasio_m, 2)} | FS=${formatAngka(p.fs, 2)}
                      </span>
                    </div>
                    <div style="font-size:10.5px;color:#64748b;margin-top:2px;">
                      ${p.zona_triase || "-"}
                    </div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>

      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-primary" id="btn-redraw-kavling-panel" style="flex:1;justify-content:center;">
          ✏️ Gambar Ulang
        </button>
        <button type="button" class="btn btn-reset-kavling-full" id="btn-reset-kavling-panel" style="flex:1.2;">
          🗑️ Reset Kavling
        </button>
      </div>
    `;

    panel.querySelectorAll(".kavling-seg-row").forEach((rowEl) => {
      const segId = rowEl.getAttribute("data-seg-id");
      const lyr = state.segmentLayersById[segId];
      if (!lyr) return;

      rowEl.addEventListener("mouseenter", () => {
        lyr.setStyle({ weight: 3.8, fillOpacity: 0.78 });
        if (lyr.openTooltip) lyr.openTooltip();
      });
      rowEl.addEventListener("mouseleave", () => {
        const p = (lyr.feature && lyr.feature.properties) || {};
        const st = tentukanGayaSegmen(p);
        lyr.setStyle({
          color: st.border,
          weight: 2.4,
          fillColor: st.fill,
          fillOpacity: 0.58,
        });
        if (lyr.closeTooltip) lyr.closeTooltip();
      });
      rowEl.addEventListener("click", () => {
        if (lyr.getBounds) {
          map.flyToBounds(lyr.getBounds().pad(0.35), { duration: 0.6, maxZoom: 17.5 });
        }
        if (lyr.openTooltip) lyr.openTooltip();
      });
    });

    const btnResetPanel = document.getElementById("btn-reset-kavling-panel");
    if (btnResetPanel) {
      btnResetPanel.addEventListener("click", () => bersihkanPilihanPeta());
    }

    const btnRedrawPanel = document.getElementById("btn-redraw-kavling-panel");
    if (btnRedrawPanel) {
      btnRedrawPanel.addEventListener("click", () => aktifkanModeGambarKavling());
    }
  }

  async function prosesAnalisisKavling(geojsonGeometry) {
    try {
      state.selectedFeature = null;
      state.inspectHighlightGroup.clearLayers();
      state.kavlingSegmentGroup.clearLayers();
      map.closePopup();
      if (state.layers.admin) {
        state.layers.admin.setStyle(styleBatasAdmin);
      }

      renderLoadingKavlingSidebar();
      setLoading("⏳ Memotong poligon kavling & menghitung Infinite Slope FS...");

      const response = await fetch("/api/analisis-segmen-kavling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometry: geojsonGeometry }),
      });

      const data = await response.json();
      if (!response.ok || data.status === "error") {
        throw new Error(data.message || `Gagal memproses poligon kavling (HTTP ${response.status}).`);
      }

      state.activeKavlingResult = data;
      sinkronStatusTombolGambar(false, true);
      renderSegmenKavlingDiPeta(data);
      renderPanelSegmenKavling(data);
      setLoading(null);
    } catch (err) {
      console.error("[KAVLING ANALYZER ERROR]", err);
      setLoading(null);
      sinkronStatusTombolGambar(false, false);
    }
  }

  // =========================================================================
  // 12. LEGENDA PETA DINAMIS (BEBAS TERM "IDW")
  // =========================================================================
  function updateLegend() {
    const el = document.getElementById("map-legend");
    if (!el) return;

    if (state.activeLegendMode === "lereng") {
      el.innerHTML = `
        <div class="legend-title">⛰️ Kemiringan Lereng (DEMNAS — Bobot 30%)</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[1]};"></span><span><b>Skor 1</b>: 0° – 8° (0% – 14,1% | Datar–Landai)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[2]};"></span><span><b>Skor 2</b>: &gt;8° – 15° (14,1% – 26,8% | Transisi)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[3]};"></span><span><b>Skor 3</b>: &gt;15° – 25° (26,8% – 46,6% | Kritis)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[4]};"></span><span><b>Skor 4</b>: &gt;25° – 35° (46,6% – 70,0% | Sangat Curam)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SLOPE_COLORS[5]};"></span><span><b>Skor 5</b>: &gt;35° (&gt;70,0% | Ekstrem / Non-Buildable)</span></div>
      `;
      return;
    }

    if (state.activeLegendMode === "geologi") {
      el.innerHTML = `
        <div class="legend-title">🪨 Litologi &amp; Formasi Geologi (Bobot 20%)</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[5]};"></span><span><b>Skor 5</b>: Tmse/Tms3 (Semilir), Tmss (Sambipitu), Teon, na</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[4]};"></span><span><b>Skor 4</b>: Tmng (Nglanggran), Tomk (Kebobutak)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[3]};"></span><span><b>Skor 3</b>: Tmps (Sentolo), Qmo (Merapi Tua)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[2]};"></span><span><b>Skor 2</b>: Qmi, Qvu3 (Merapi Muda | φ'=37°–48°)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[1]};"></span><span><b>Skor 1</b>: Tmwl (Wonosari), Qa (Aluvial)</span></div>
      `;
      return;
    }

    if (state.activeLegendMode === "tanah") {
      el.innerHTML = `
        <div class="legend-title">🌱 Karakteristik Tanah / Pedologi (Bobot 25%)</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[5]};"></span><span><b>Skor 5</b>: Grumusol (c'=9 kPa, φ'=15°, γsat=19, z=2m)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[4]};"></span><span><b>Skor 4</b>: Latosol (c'=10, φ'=18°) &amp; Mediteran (c'=11, φ'=20°)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[3]};"></span><span><b>Skor 3</b>: Regosol (c'=3,5 kPa, φ'=36°, γsat=17,5, z=1m)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[2]};"></span><span><b>Skor 2</b>: Kambisol (c'=8 kPa, φ'=30°, γsat=18, z=2m)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${SCORE_COLORS[1]};"></span><span><b>Skor 1</b>: Aluvial (c'=14 kPa, φ'=25°, γsat=18,5, z=4m)</span></div>
      `;
      return;
    }

    if (state.activeLegendMode === "hujan") {
      el.innerHTML = `
        <div class="legend-title">🌧️ Curah Hujan Tahunan (Isohyet — Bobot 15%)</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${RAINFALL_COLORS[5]};"></span><span><b>Skor 5</b>: &gt; 3.000 mm/tahun (Rasio m = 0,90)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${RAINFALL_COLORS[4]};"></span><span><b>Skor 4</b>: 2.501 – 3.000 mm/tahun (Rasio m = 0,75)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${RAINFALL_COLORS[3]};border:1px solid #94a3b8;"></span><span><b>Skor 3</b>: 2.001 – 2.500 mm/tahun (Rasio m = 0,60)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${RAINFALL_COLORS[2]};"></span><span><b>Skor 2</b>: 1.500 – 2.000 mm/tahun (Rasio m = 0,45)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:${RAINFALL_COLORS[1]};"></span><span><b>Skor 1</b>: &lt; 1.500 mm/tahun (Rasio m = 0,30)</span></div>
      `;
      return;
    }

    if (state.activeLegendMode === "tutupan") {
      el.innerHTML = `
        <div class="legend-title">🏡 Tutupan Lahan (RBI 25K — Bobot 10%)</div>
        <div class="legend-row"><span class="legend-swatch" style="background:#D32F2F;"></span><span><b>Skor 5</b>: Tanah Terbuka / Tambang / Tegalan / Sawah &gt;8° (cr=0, q=0)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:#FB8C00;"></span><span><b>Skor 4</b>: Semak Belukar / Alang-alang (cr=0,5 kPa, q=0)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:#FFB300;"></span><span><b>Skor 3</b>: Permukiman / Bangunan / Jalan (cr=0, q=15 kPa)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:#66BB6A;"></span><span><b>Skor 2</b>: Perkebunan / Kebun Campuran (cr=3,5 kPa, q=0)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:#2E7D32;"></span><span><b>Skor 1</b>: Hutan Lahan Kering / Lindung / Air (cr=10 kPa, q=0)</span></div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="legend-title">📊 ZONA KELAYAKAN GPKG (PERMEN PU 22/2007)</div>
      <div style="font-size:9.5px;color:#475569;margin-bottom:5px;line-height:1.35;">
        <b>Skor Akhir</b> = 0,30 Lereng + 0,25 Tanah + 0,20 Batuan + 0,15 Hujan + 0,10 Lahan
      </div>
      <div class="legend-row">
        <span class="legend-swatch" style="background:#2E7D32;border:1px solid #1B5E20;"></span>
        <span><b>Skor &lt; 2,20</b>: ZONA HIJAU (Datar / Risiko Rendah / Konstruksi Standar)</span>
      </div>
      <div class="legend-row">
        <span class="legend-swatch" style="background:#FB8C00;border:1px solid #E65100;"></span>
        <span><b>Skor 2,20 – 3,40</b>: ZONA KUNING (Risiko Sedang / Perlu Mitigasi Drainase &amp; Talud)</span>
      </div>
      <div class="legend-row">
        <span class="legend-swatch" style="background:#D32F2F;border:1px solid #B71C1C;"></span>
        <span><b>Skor &gt; 3,40</b>: ZONA MERAH (Risiko Tinggi / Rawan Longsor / Non-Buildable)</span>
      </div>
    `;
  }

  // =========================================================================
  // 13. KONTROL LAYER SPASIAL & OPACITY SLIDERS (SIDEBAR KIRI + FLOATING)
  // =========================================================================
  function terapkanOpacityLayer(layerKey, opacityRatio) {
    state.layerOpacities[layerKey] = opacityRatio;

    // Sinkronkan slider & label di Floating Panel dan Left Sidebar
    const pct = Math.round(opacityRatio * 100);
    document.querySelectorAll(`[data-opacity-key="${layerKey}"]`).forEach((inp) => {
      inp.value = String(pct);
    });
    const flLbl = document.getElementById(`opacity-lbl-${layerKey}`);
    if (flLbl) flLbl.textContent = `${pct}%`;
    const sbLbl = document.getElementById(`sb-opacity-lbl-${layerKey}`);
    if (sbLbl) sbLbl.textContent = `${pct}%`;

    const lyr = state.layers[layerKey];
    if (!lyr) return;

    if (layerKey === "admin") {
      lyr.setStyle(styleBatasAdmin);
      return;
    }

    if (typeof lyr.setStyle === "function") {
      lyr.setStyle({
        fillOpacity: opacityRatio,
        opacity: Math.min(1.0, opacityRatio + 0.2),
      });
    }
  }

  function renderKontrolLayerSidebarKiri() {
    const container = document.getElementById("sidebar-layer-controls");
    if (!container) return;

    const thematicLayers = LAYER_META.slice(0, 7);
    container.innerHTML = thematicLayers
      .map((m) => {
        const pct = Math.round((state.layerOpacities[m.key] ?? m.defaultOpacity) * 100);
        return `
          <div class="sidebar-layer-card" id="sb-card-${m.key}">
            <label class="layer-switch-item" style="padding:1px 2px;">
              <input type="checkbox" data-sb-layer-key="${m.key}" />
              <span style="font-size:11px;font-weight:600;">${m.label}</span>
            </label>
            <div class="layer-opacity-row" id="sb-opacity-wrap-${m.key}" style="display:none;">
              <span>Transparansi</span>
              <input type="range" min="10" max="100" step="5" value="${pct}" data-opacity-key="${m.key}" />
              <b id="sb-opacity-lbl-${m.key}">${pct}%</b>
            </div>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll("[data-sb-layer-key]").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        const key = e.target.getAttribute("data-sb-layer-key");
        const meta = LAYER_META.find((x) => x.key === key);
        if (!meta) return;
        const mainChk = document.getElementById(meta.chkId);
        if (mainChk && mainChk.checked !== e.target.checked) {
          mainChk.checked = e.target.checked;
          mainChk.dispatchEvent(new Event("change"));
        }
      });
    });

    container.querySelectorAll("[data-opacity-key]").forEach((rng) => {
      rng.addEventListener("input", (e) => {
        const key = e.target.getAttribute("data-opacity-key");
        const val = Number(e.target.value) / 100;
        terapkanOpacityLayer(key, val);
      });
    });
  }

  function sinkronTampilanToggleLayer(layerKey, isChecked) {
    const flWrap = document.getElementById(`opacity-wrap-${layerKey}`);
    if (flWrap) flWrap.style.display = isChecked ? "flex" : "none";

    const sbWrap = document.getElementById(`sb-opacity-wrap-${layerKey}`);
    if (sbWrap) sbWrap.style.display = isChecked ? "flex" : "none";

    const sbCard = document.getElementById(`sb-card-${layerKey}`);
    if (sbCard) sbCard.classList.toggle("active", Boolean(isChecked));

    const sbChk = document.querySelector(`[data-sb-layer-key="${layerKey}"]`);
    if (sbChk && sbChk.checked !== isChecked) {
      sbChk.checked = isChecked;
    }
  }

  // =========================================================================
  // 14. PEMUATAN DATASET GEOJSON
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
    if (filename === "clean_tutupan_lahan_diy.geojson" || filename === "clean_tutupan_lahan_sleman_bantul.geojson") {
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
        // lanjut ke HTTP fetch
      }
    }
    const paths = [
      `/data/${filename}`,
      `../public/data/${filename}`,
      `public/data/${filename}`,
      `../Data/processed/${filename}`,
      `/Data/processed/${filename}`,
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
      setLoading("⏳ Memuat pipeline data geospasial & matriks Dasar.xlsx DIY...");
      renderKontrolLayerSidebarKiri();

      const [
        adminData,
        areaDevData,
        titikDevData,
        posHujanData,
        hujanIsohyetData,
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
      state.hujanFeatures = hujanIsohyetData.features || [];
      state.demnasFeatures = demnasData.features || [];
      state.lerengFeatures = lerengPolyData ? lerengPolyData.features || [] : [];
      state.geologiFeatures = geologiPolyData ? geologiPolyData.features || [] : [];
      state.tanahFeatures = tanahPolyData ? tanahPolyData.features || [] : [];

      let nHijau = 0,
        nKuning = 0,
        nMerah = 0;

      for (const f of state.adminFeatures) {
        const p = f.properties || {};
        const l = evaluasiKemiringanLereng(p.lereng_derajat, p.lereng_persen);
        const pd = evaluasiPedologiTanah(p.jenis_tanah);
        const lt = evaluasiLitologiGeologi(p.formasi_batuan, "");
        const hj = evaluasiCurahHujanTahunan(p.curah_hujan_mm, p.skor_hujan, p.rasio_m);
        const tu = evaluasiTutupanLahan(p.tutupan_dominan, l.derajat);
        const tr = evaluasiZonaGPKG(l, pd, lt, hj, tu);

        p._gpkgHex = tr.hex;
        p._gpkgZonaNama = tr.namaZona;
        p._gpkgSkor = tr.skorAkhir;

        if (tr.kode === "hijau") nHijau++;
        else if (tr.kode === "kuning") nKuning++;
        else nMerah++;
      }

      document.getElementById("stat-hijau").textContent = String(nHijau);
      document.getElementById("stat-kuning").textContent = String(nKuning);
      document.getElementById("stat-merah").textContent = String(nMerah);

      // 1. Layer Batas Administrasi Kalurahan
      state.layers.admin = buatLayerGeoJsonUTM(adminData, {
        renderer: canvasRenderer,
        style: styleBatasAdmin,
      }).addTo(map);

      // 2. Layer Kemiringan Lereng (DEMNAS)
      if (lerengPolyData) {
        state.layers.lerengPoly = buatLayerGeoJsonUTM(lerengPolyData, {
          renderer: canvasRenderer,
          interactive: false,
          style: (feature) => {
            const s = Number(feature.properties.skor_lereng || feature.properties.skor || 1);
            return {
              color: "#0f172a",
              weight: 0.4,
              fillColor: SLOPE_COLORS[s] || "#1a9850",
              fillOpacity: state.layerOpacities.lerengPoly,
            };
          },
        });
      }

      // 3. Layer Litologi & Formasi Geologi
      if (geologiPolyData) {
        state.layers.geologi = buatLayerGeoJsonUTM(geologiPolyData, {
          renderer: canvasRenderer,
          interactive: true,
          style: (feature) => {
            const fp = feature.properties || {};
            const infoLito = evaluasiLitologiGeologi(fp.formasi_batuan || `${fp.NAME || ""} (${fp.SYMBOLS || ""})`, fp.ket_batuan);
            const s = Number(fp.skor_batuan || infoLito.skor || 2);
            return {
              color: "#1e293b",
              weight: 1.0,
              fillColor: SCORE_COLORS[s] || "#66BB6A",
              fillOpacity: state.layerOpacities.geologi,
            };
          },
          onEachFeature: (feature, layer) => {
            const fp = feature.properties || {};
            const infoLito = evaluasiLitologiGeologi(fp.formasi_batuan || `${fp.NAME || ""} (${fp.SYMBOLS || ""})`, fp.ket_batuan);
            layer.bindTooltip(
              `<b>🪨 ${infoLito.nama}</b><br><span style="font-size:11px;">Skor Geologi: <b>${infoLito.skor}/5</b> — ${infoLito.litologi}</span>`,
              { sticky: true }
            );
            layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, null));
          },
        });
      }

      // 4. Layer Karakteristik Tanah (Pedologi)
      if (tanahPolyData) {
        state.layers.tanah = buatLayerGeoJsonUTM(tanahPolyData, {
          renderer: canvasRenderer,
          interactive: true,
          style: (feature) => {
            const fp = feature.properties || {};
            const infoTanah = evaluasiPedologiTanah(fp.jenis_tanah || fp.jns_tnh);
            const s = Number(fp.skor_tanah || infoTanah.skor || 3);
            return {
              color: "#1e293b",
              weight: 1.0,
              fillColor: SCORE_COLORS[s] || "#FFB300",
              fillOpacity: state.layerOpacities.tanah,
            };
          },
          onEachFeature: (feature, layer) => {
            const fp = feature.properties || {};
            const infoTanah = evaluasiPedologiTanah(fp.jenis_tanah || fp.jns_tnh);
            layer.bindTooltip(
              `<b>🌱 ${infoTanah.nama}</b><br><span style="font-size:11px;">Skor Tanah: <b>${infoTanah.skor}/5</b> | ${infoTanah.sifatRingkas}</span>`,
              { sticky: true }
            );
            layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, null));
          },
        });
      }

      // 5. Layer Curah Hujan Tahunan (Isohyet) — Tanpa string IDW
      state.layers.idwHujan = buatLayerGeoJsonUTM(hujanIsohyetData, {
        renderer: canvasRenderer,
        interactive: true,
        style: (feature) => {
          const fp = feature.properties || {};
          const infoHujan = evaluasiCurahHujanTahunan(fp.curah_hujan_mm, fp.skor_hujan, fp.rasio_m);
          const fillHex = fp.warna_hex || RAINFALL_COLORS[infoHujan.skor] || "#FFFF00";
          return {
            color: "#1e293b",
            weight: 1.1,
            dashArray: "5,3",
            fillColor: fillHex,
            fillOpacity: state.layerOpacities.idwHujan,
          };
        },
        onEachFeature: (feature, layer) => {
          const fp = feature.properties || {};
          const infoHujan = evaluasiCurahHujanTahunan(fp.curah_hujan_mm, fp.skor_hujan, fp.rasio_m);
          layer.bindTooltip(
            `<b>🌧️ Curah Hujan Tahunan (Isohyet): ${formatAngka(infoHujan.chMm, 0)} mm/thn</b><br><span style="font-size:11px;">Skor Hujan: <b>${infoHujan.skor}/5</b> | Rasio Kejenuhan m = <b>${formatAngka(infoHujan.mRatio, 2)}</b></span>`,
            { sticky: true }
          );
          layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, null));
        },
      });

      // 6. Layer Grid DEMNAS DIY UTM
      state.layers.demnas = buatLayerGeoJsonUTM(demnasData, {
        renderer: canvasRenderer,
        interactive: false,
        style: () => ({
          color: "#a855f7",
          weight: 1.8,
          dashArray: "6,4",
          fillColor: "#9333ea",
          fillOpacity: 0.14,
        }),
      });

      // 7. Layer Area Jangkauan Uji Developer
      state.layers.areaDev = buatLayerGeoJsonUTM(areaDevData, {
        renderer: canvasRenderer,
        style: (feature) => {
          const p = feature.properties || {};
          const l = evaluasiKemiringanLereng(p.lereng_derajat, p.lereng_persen);
          const pd = evaluasiPedologiTanah(p.jenis_tanah);
          const lt = evaluasiLitologiGeologi(p.formasi_batuan, "");
          const hj = evaluasiCurahHujanTahunan(p.curah_hujan_mm);
          const tu = evaluasiTutupanLahan(p.tutupan_dominan, l.derajat);
          const tr = evaluasiZonaGPKG(l, pd, lt, hj, tu);
          return {
            color: "#ffffff",
            weight: 1.5,
            dashArray: "3,3",
            fillColor: tr.hex,
            fillOpacity: state.layerOpacities.areaDev,
          };
        },
        onEachFeature: (feature, layer) => {
          layer.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            inspeksiTitikPeta(e.latlng, feature.properties);
          });
        },
      });

      // 8. Layer Pos Pengamatan Hujan BBWS
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
          const p = feature.properties || {};
          layer.bindTooltip(
            `<b>💧 Pos Hujan: ${p.nama_pos || "BBWS Serayu Opak"}</b><br><span style="font-size:11px;">Curah Hujan Tahunan: <b>${formatAngka(p.curah_hujan_mm, 0)} mm/thn</b></span>`,
            { sticky: true }
          );
          layer.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            inspeksiTitikPeta(e.latlng, feature.properties);
          });
        },
      });

      // 9. Layer Titik Uji Sampel Developer
      state.layers.titikDev = buatLayerGeoJsonUTM(titikDevData, {
        pointToLayer: (feature, latlng) => {
          const p = feature.properties || {};
          const l = evaluasiKemiringanLereng(p.lereng_derajat, p.lereng_persen);
          const pd = evaluasiPedologiTanah(p.jenis_tanah);
          const lt = evaluasiLitologiGeologi(p.formasi_batuan, "");
          const hj = evaluasiCurahHujanTahunan(p.curah_hujan_mm);
          const tu = evaluasiTutupanLahan(p.tutupan_dominan, l.derajat);
          const tr = evaluasiZonaGPKG(l, pd, lt, hj, tu);
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
            inspeksiTitikPeta(e.latlng, feature.properties);
          });
        },
      });

      inisialisasiFilterHierarkis();
      renderEmptyStateSidebar();
      updateLegend();
      setLoading(null);
    } catch (err) {
      console.error(err);
      setLoading("⚠️ Gagal memuat dataset spasial DIY.");
    }
  }

  async function toggleKerawananLongsor(checked) {
    sinkronTampilanToggleLayer("kerawananLongsor", checked);
    if (!checked) {
      if (state.layers.kerawananLongsor && map.hasLayer(state.layers.kerawananLongsor)) {
        map.removeLayer(state.layers.kerawananLongsor);
      }
      return;
    }
    if (state.kerawananLoaded && state.layers.kerawananLongsor) {
      state.layers.kerawananLongsor.addTo(map);
      terapkanOpacityLayer("kerawananLongsor", state.layerOpacities.kerawananLongsor);
      state.activeLegendMode = "triase";
      updateLegend();
      return;
    }
    try {
      setLoading("⏳ Memuat Peta Skoring Kerawanan Longsor (GPKG)...");
      const data = await fetchGeoJSON("clean_kerawanan_longsor.geojson");
      state.kerawananFeatures = data.features || [];
      state.layers.kerawananLongsor = buatLayerGeoJsonUTM(data, {
        renderer: canvasRenderer,
        interactive: true,
        style: (feature) => {
          const fp = feature.properties || {};
          return {
            fillColor: fp.warna_hex || "#2E7D32",
            color: fp.border_hex || "#1e293b",
            weight: 0.9,
            fillOpacity: state.layerOpacities.kerawananLongsor,
          };
        },
        onEachFeature: (feature, layer) => {
          const fp = feature.properties || {};
          const skorAkhir = Number(fp.skor_akhir || 2.0).toFixed(2);
          const statusZona = fp.zona_triase || "ZONA HIJAU";
          const fsVal = Number(fp.fs || 5.0).toFixed(2);
          layer.bindTooltip(
            `<b>📊 Skor GPKG: ${skorAkhir} / 5,00 | FS = ${fsVal} (${fp.fs_label || "STABIL"})</b><br><span style="font-size:11px;"><b>${statusZona}</b><br>Lereng=${fp.skor_lereng ?? "-"} (${fp.lereng_derajat ?? "-"}°) | Tanah=${fp.skor_tanah ?? "-"} | Batuan=${fp.skor_batuan ?? "-"} | Hujan=${fp.skor_hujan ?? "-"} | Lahan=${fp.skor_lahan ?? "-"}</span>`,
            { sticky: true }
          );
          layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, null));
        },
      }).addTo(map);
      state.kerawananLoaded = true;
      state.activeLegendMode = "triase";
      updateLegend();
      setLoading(null);
    } catch (err) {
      console.error(err);
      setLoading(null);
    }
  }

  async function toggleTutupanLahan(checked) {
    sinkronTampilanToggleLayer("tutupan", checked);
    if (!checked) {
      if (state.layers.tutupan && map.hasLayer(state.layers.tutupan)) {
        map.removeLayer(state.layers.tutupan);
      }
      if (state.activeLegendMode === "tutupan") {
        state.activeLegendMode = "triase";
        updateLegend();
      }
      return;
    }
    if (state.tutupanLoaded && state.layers.tutupan) {
      state.layers.tutupan.addTo(map);
      terapkanOpacityLayer("tutupan", state.layerOpacities.tutupan);
      state.activeLegendMode = "tutupan";
      updateLegend();
      return;
    }
    try {
      setLoading("⏳ Memuat layer Tutupan Lahan (RBI 25K)...");
      const data = await fetchGeoJSON("clean_tutupan_lahan_diy.geojson");
      state.tutupanFeatures = data.features || [];
      state.layers.tutupan = buatLayerGeoJsonUTM(data, {
        renderer: canvasRenderer,
        interactive: true,
        style: (feature) => {
          const fp = feature.properties || {};
          const tu = evaluasiTutupanLahan(fp.tutupan_lahan || fp.klasifikasi, 5);
          const sLahan = Number(fp.skor_lahan || tu.skor || 3);
          const fillHex = fp.warna_hex || SCORE_COLORS[sLahan] || tu.warnaHex || "#FFB300";
          return {
            color: "#1e293b",
            weight: 0.45,
            fillColor: fillHex,
            fillOpacity: state.layerOpacities.tutupan,
          };
        },
        onEachFeature: (feature, layer) => {
          const fp = feature.properties || {};
          const namaPl = fp.tutupan_lahan || fp.klasifikasi || "Tutupan Lahan";
          const tu = evaluasiTutupanLahan(namaPl, 5);
          layer.bindTooltip(
            `<b>🏡 Tutupan Lahan: ${namaPl}</b><br><span style="font-size:11px;">Skor Lahan: <b>${tu.skor}/5</b> (Bobot 10%) — cr=${tu.crKpa} kPa, q=${tu.qKpa} kPa</span>`,
            { sticky: true }
          );
          layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, null));
        },
      }).addTo(map);
      state.tutupanLoaded = true;
      state.activeLegendMode = "tutupan";
      updateLegend();
      setLoading(null);
    } catch (err) {
      console.error(err);
      setLoading(null);
    }
  }

  // =========================================================================
  // 15. EVENT HANDLERS
  // =========================================================================
  map.on("click", (e) => {
    if (state.isDrawingKavling || (map.pm && map.pm.globalDrawModeEnabled())) {
      return;
    }
    inspeksiTitikPeta(e.latlng, null);
  });

  if (map.pm) {
    map.pm.addControls({
      position: "topleft",
      drawPolygon: true,
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawCircle: false,
      drawText: false,
      editMode: false,
      dragMode: false,
      cutPolygon: false,
      removalMode: false,
      rotateMode: false,
    });

    map.on("pm:drawstart", () => {
      state.isDrawingKavling = true;
      sinkronStatusTombolGambar(true, Boolean(state.activeKavlingResult));
    });

    map.on("pm:drawend", () => {
      state.isDrawingKavling = false;
      sinkronStatusTombolGambar(false, Boolean(state.activeKavlingResult));
    });

    map.on("pm:create", (e) => {
      state.isDrawingKavling = false;
      const sketchLayer = e.layer;
      const geojsonFeat = sketchLayer.toGeoJSON();
      map.removeLayer(sketchLayer);
      if (geojsonFeat && geojsonFeat.geometry) {
        prosesAnalisisKavling(geojsonFeat.geometry);
      }
    });
  }

  const btnDrawKavling = document.getElementById("btn-draw-kavling");
  if (btnDrawKavling) {
    btnDrawKavling.addEventListener("click", (e) => {
      L.DomEvent.stopPropagation(e);
      aktifkanModeGambarKavling();
    });
  }

  const btnDrawKavlingTop = document.getElementById("btn-draw-kavling-top");
  if (btnDrawKavlingTop) {
    btnDrawKavlingTop.addEventListener("click", (e) => {
      L.DomEvent.stopPropagation(e);
      aktifkanModeGambarKavling();
    });
  }

  const btnResetKavlingMap = document.getElementById("btn-reset-kavling-map");
  if (btnResetKavlingMap) {
    btnResetKavlingMap.addEventListener("click", (e) => {
      L.DomEvent.stopPropagation(e);
      bersihkanPilihanPeta();
    });
  }

  const btnDemoKavling = document.getElementById("btn-demo-kavling");
  if (btnDemoKavling) {
    btnDemoKavling.addEventListener("click", (e) => {
      L.DomEvent.stopPropagation(e);
      if (map.pm && map.pm.globalDrawModeEnabled()) {
        map.pm.disableDraw();
      }
      const demoPolygonWgs84 = {
        type: "Polygon",
        coordinates: [
          [
            [110.40119, -7.92426],
            [110.40392, -7.92427],
            [110.40391, -7.92155],
            [110.40119, -7.92155],
            [110.40119, -7.92426],
          ],
        ],
      };
      prosesAnalisisKavling(demoPolygonWgs84);
    });
  }

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

  // Toggle Floating Layer Controller
  const btnToggleLayerPanel = document.getElementById("btn-toggle-layer-panel");
  const layerSwitcherEl = document.getElementById("map-layer-switcher");
  if (btnToggleLayerPanel && layerSwitcherEl) {
    btnToggleLayerPanel.addEventListener("click", () => {
      layerSwitcherEl.classList.toggle("collapsed");
    });
  }

  // Checkbox Garis Batas Administrasi Kalurahan
  const chkAdmin = document.getElementById("chk-admin");
  if (chkAdmin) {
    chkAdmin.addEventListener("change", (e) => {
      state.showAdminOutlines = e.target.checked;
      sinkronTampilanToggleLayer("admin", e.target.checked);
      if (state.layers.admin) {
        state.layers.admin.setStyle(styleBatasAdmin);
      }
    });
  }

  // Checkbox Zona Kerawanan Longsor
  const chkKerawanan = document.getElementById("chk-kerawanan-longsor");
  if (chkKerawanan) {
    chkKerawanan.addEventListener("change", (e) => {
      toggleKerawananLongsor(e.target.checked);
    });
  }

  // Checkbox Tutupan Lahan
  const chkTutupan = document.getElementById("chk-tutupan");
  if (chkTutupan) {
    chkTutupan.addEventListener("change", (e) => {
      toggleTutupanLahan(e.target.checked);
    });
  }

  // Checkbox Layer Spasial lainnya
  const overlayToggles = [
    ["chk-lereng-poly", "lerengPoly"],
    ["chk-geologi", "geologi"],
    ["chk-tanah", "tanah"],
    ["chk-hujan", "idwHujan"],
    ["chk-area-dev", "areaDev"],
    ["chk-titik-dev", "titikDev"],
    ["chk-pos-hujan", "posHujan"],
    ["chk-demnas", "demnas"],
  ];

  for (const [id, key] of overlayToggles) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("change", (e) => {
      const checked = e.target.checked;
      sinkronTampilanToggleLayer(key, checked);
      const lyr = state.layers[key];
      if (!lyr) return;
      if (checked) {
        lyr.addTo(map);
        if (state.layerOpacities[key] !== undefined) {
          terapkanOpacityLayer(key, state.layerOpacities[key]);
        }
        if (key === "lerengPoly") state.activeLegendMode = "lereng";
        else if (key === "geologi") state.activeLegendMode = "geologi";
        else if (key === "tanah") state.activeLegendMode = "tanah";
        else if (key === "idwHujan") state.activeLegendMode = "hujan";
      } else {
        map.removeLayer(lyr);
        const chkL = document.getElementById("chk-lereng-poly");
        const chkG = document.getElementById("chk-geologi");
        const chkT = document.getElementById("chk-tanah");
        const chkH = document.getElementById("chk-hujan");
        if (chkL && chkL.checked) state.activeLegendMode = "lereng";
        else if (chkG && chkG.checked) state.activeLegendMode = "geologi";
        else if (chkT && chkT.checked) state.activeLegendMode = "tanah";
        else if (chkH && chkH.checked) state.activeLegendMode = "hujan";
        else state.activeLegendMode = "triase";
      }
      updateLegend();
    });
  }

  // Event handler slider opacity di Floating Layer Controller
  document.querySelectorAll("#layer-switcher-body [data-opacity-key]").forEach((rng) => {
    rng.addEventListener("input", (e) => {
      const key = e.target.getAttribute("data-opacity-key");
      const val = Number(e.target.value) / 100;
      terapkanOpacityLayer(key, val);
    });
  });

  // Opacity Slider Sorotan Kalurahan
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

  // Basemap Switcher
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
        inspeksiTitikPeta(ll, null);
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
        inspeksiTitikPeta(ll, null);
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

  muatLayerUtama();
})();
