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

  map.createPane("spkLandUsePane");
  map.getPane("spkLandUsePane").style.zIndex = 430;
  map.createPane("spkSensitivePane");
  map.getPane("spkSensitivePane").style.zIndex = 440;
  map.createPane("spkLegalPane");
  map.getPane("spkLegalPane").style.zIndex = 450;
  const spkLandUseRenderer = L.svg({ pane: "spkLandUsePane", padding: 0.5 });
  const spkSensitiveRenderer = L.svg({ pane: "spkSensitivePane", padding: 0.5 });

  L.control.zoom({ position: "topright" }).addTo(map);
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
    activeKavlingGeometry: null,
    kavlingOutlineGroup: L.layerGroup().addTo(map),
    segmentLayersById: {},
    spkLandUseGroup: L.layerGroup(),
    spkSensitiveGroup: L.layerGroup(),
    spkLegalGroup: L.layerGroup(),
    spkLandUseReport: null,
    spkSensitiveReport: null,
    spkAssessment: null,
    spkLegendBefore: null,
    spkSpatialLegendBefore: null,
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

  function escapeLegendText(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
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

  function terapkanZonaSkor(triase, skor) {
    const numSkor = Number(skor);
    if (!Number.isFinite(numSkor)) return;

    let kode = "hijau";
    let hex = "#10b981";
    let namaZona = "Zona Hijau";
    let zonaKode = "ZONA HIJAU";
    let deskripsi = "Datar / Risiko Rendah / Konstruksi Standar";

    if (numSkor > 3.40) {
      kode = "merah";
      hex = "#ef4444";
      namaZona = "Zona Merah";
      zonaKode = "ZONA MERAH";
      deskripsi = "Risiko Tinggi / Rawan Longsor / Non-Buildable";
    } else if (numSkor >= 2.20) {
      kode = "kuning";
      hex = "#f59e0b";
      namaZona = "Zona Kuning";
      zonaKode = "ZONA KUNING";
      deskripsi = "Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud";
    }

    triase.skorAkhir = numSkor;
    triase.skorTampil = numSkor.toFixed(2);
    triase.kode = kode;
    triase.hex = hex;
    triase.namaZona = namaZona;
    triase.zonaKode = zonaKode;
    triase.deskripsi = deskripsi;
    triase.zonaTriase = `${zonaKode} (${deskripsi})`;
    triase.badge = `SKOR ${numSkor.toFixed(2)} — ${zonaKode}`;
  }

  function terapkanFsInfo(triase, fs, label, hex, keterangan) {
    const numFs = Number(fs);
    if (!Number.isFinite(numFs)) return;

    const status = label || (numFs > 1.25 ? "STABIL" : (numFs >= 1.07 ? "KRITIS" : "LABIL / LONGSOR"));
    const statusKode = status.includes("LABIL") ? "labil" : (status.includes("KRITIS") ? "rawan" : "stabil");
    const warnaHex = hex || (numFs > 1.25 ? "#10b981" : (numFs >= 1.07 ? "#f59e0b" : "#ef4444"));
    const ket = keterangan || (numFs > 1.25
      ? "Lereng stabil terhadap gelincir translasi (FS > 1,25)."
      : (numFs >= 1.07
        ? "Kestabilan lereng berada pada ambang kritis / rawan rayapan saat jenuh air pori (1,07 ≤ FS ≤ 1,25)."
        : "Gaya penggerak melampaui tahanan geser efektif; lereng labil dan rawan longsor saat jenuh (FS < 1,07)."));

    triase.fs = numFs;
    triase.fsTampil = numFs.toFixed(2);
    triase.fsLabel = status;
    triase.fsHex = warnaHex;
    if (triase.fsInfo) {
      triase.fsInfo.fs = numFs;
      triase.fsInfo.status = status;
      triase.fsInfo.statusKode = statusKode;
      triase.fsInfo.warnaHex = warnaHex;
      triase.fsInfo.keterangan = ket;
    }
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

    let closest = null;
    let minDist = 0.15 * 0.15;
    for (const feat of state.adminFeatures) {
      const p = feat.properties || {};
      const cx = p.bujur_wgs84 != null ? Number(p.bujur_wgs84) : (p.easting_x ? utm49sToLatLng([p.easting_x, p.northing_y]).lng : null);
      const cy = p.lintang_wgs84 != null ? Number(p.lintang_wgs84) : (p.northing_y ? utm49sToLatLng([p.easting_x, p.northing_y]).lat : null);
      if (cx !== null && cy !== null) {
        const d = (lng - cx) * (lng - cx) + (lat - cy) * (lat - cy);
        if (d < minDist) {
          minDist = d;
          closest = feat;
        }
      }
    }
    return closest || (state.adminFeatures.length ? state.adminFeatures[0] : null);
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

    const rawSkor = (rawProps && rawProps.skor_akhir != null)
      ? rawProps.skor_akhir
      : (krProps.skor_akhir ?? adminProps.skor_total);
    if (rawSkor !== undefined && rawSkor !== null) {
      terapkanZonaSkor(triase, rawSkor);
    }

    const rawFs = (rawProps && rawProps.fs != null)
      ? rawProps.fs
      : (krProps.fs ?? adminProps.fs);
    if (rawFs !== undefined && rawFs !== null) {
      terapkanFsInfo(
        triase,
        rawFs,
        (rawProps && rawProps.fs_status) || krProps.fs_status || adminProps.fs_status
      );
    }

    const kalurahan =
      adminProps.kalurahan ||
      adminProps.KALURAHAN ||
      mergedProps.kalurahan ||
      mergedProps.KALURAHAN ||
      "-";
    const kapanewon =
      adminProps.kapanewon ||
      adminProps.KECAMATAN ||
      mergedProps.kapanewon ||
      mergedProps.KECAMATAN ||
      "-";
    const kabupaten =
      adminProps.kabupaten ||
      adminProps.KABUPATEN ||
      mergedProps.kabupaten ||
      mergedProps.KABUPATEN ||
      "Kab. Sleman";
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
      elevasiMdpl: adminProps.elevasi_mdpl ?? mergedProps.elevasi_mdpl ?? 115,
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

    const searchEl = document.getElementById("admin-search");
    if (searchEl) {
      searchEl.addEventListener("input", () => {
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
        if (searchEl) searchEl.value = "";
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
      banner.hidden = true;
      banner.innerHTML = "";
      return;
    }
    const p = feat.properties;
    banner.hidden = false;
    banner.innerHTML = `
      <div><strong>Kal. ${p.kalurahan}</strong> · Kapanewon ${p.kapanewon} · ${p.kabupaten}</div>
      <div style="margin-top:2px;color:var(--text-muted);">
        Skor GPKG <strong>${formatAngka(p._gpkgSkor, 2)}</strong> · ${p._gpkgZonaNama || "Zona"} · Lereng DEMNAS <strong>${formatAngka(p.lereng_derajat, 2)}°</strong>
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
    const searchEl = document.getElementById("admin-search");
    if (!container) return;

    const query = (searchEl && searchEl.value ? searchEl.value : "").trim().toLowerCase();
    let filtered = state.adminFeatures.filter((f) => apakahFiturLolosFilter(f.properties || {}));
    if (query) {
      filtered = filtered.filter((f) => {
        const p = f.properties || {};
        return `${p.kalurahan || ""} ${p.kapanewon || ""} ${p.kabupaten || ""}`
          .toLowerCase()
          .includes(query);
      });
    }

    if (badgeEl) {
      badgeEl.textContent = `${filtered.length} kalurahan`;
    }

    const tampil = filtered.slice(0, 40);
    if (!tampil.length) {
      container.innerHTML = `
        <div class="region-empty">
          Tidak ada kalurahan yang cocok dengan filter atau pencarian saat ini.
        </div>
      `;
      return;
    }

    container.innerHTML = tampil
      .map((f, idx) => {
        const p = f.properties || {};
        const zHex = p._gpkgHex || TRIAGE_HEX.hijau;
        const zNama = (p._gpkgZonaNama || "Zona Hijau").replace("Zona ", "");
        const isSelected =
          state.filterKal === p.kalurahan &&
          state.filterKap === p.kapanewon &&
          state.filterKab === p.kabupaten;
        return `
          <button type="button" class="region-item${isSelected ? " is-selected" : ""}" data-idx="${idx}">
            <span class="region-item-main">
              <span class="region-item-name">Kal. ${p.kalurahan}</span>
              <span class="region-item-meta">Kapanewon ${p.kapanewon} · ${p.kabupaten} · β ${formatAngka(p.lereng_derajat, 2)}°</span>
            </span>
            <span class="region-item-score">
              <span class="zone-dot" style="background:${zHex};"></span>${zNama} ${formatAngka(p._gpkgSkor, 2)}
            </span>
          </button>
        `;
      })
      .join("");

    container.querySelectorAll(".region-item").forEach((el, idx) => {
      el.addEventListener("click", () => {
        const feat = tampil[idx];
        if (!feat) return;
        const p = feat.properties || {};

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

        container.querySelectorAll(".region-item").forEach((item) => item.classList.remove("is-selected"));
        el.classList.add("is-selected");
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
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg class="icon" aria-hidden="true"><use href="#icon-layers"></use></svg>
        </div>
        <h2>Pilih lokasi untuk memulai analisis</h2>
        <p>
          Panel ini menampilkan ringkasan keputusan, kestabilan lereng, parameter skoring,
          dan audit trail geoteknik untuk wilayah atau titik yang dipilih.
        </p>

        <div class="empty-steps">
          <div class="empty-step">
            <span class="step-index">1</span>
            <span>Pilih kabupaten, kapanewon, dan kalurahan pada panel wilayah.</span>
          </div>
          <div class="empty-step">
            <span class="step-index">2</span>
            <span>Atau klik langsung pada peta untuk inspeksi titik WGS 84 / UTM 49S.</span>
          </div>
          <div class="empty-step">
            <span class="step-index">3</span>
            <span>Gambar poligon kavling untuk analisis segmentasi zona dan lereng.</span>
          </div>
        </div>

        <div class="empty-actions">
          <button type="button" class="btn btn-primary btn-block" id="btn-empty-draw-kavling">
            <svg class="icon" aria-hidden="true"><use href="#icon-polygon"></use></svg>Gambar poligon kavling
          </button>
        </div>

        <div class="quick-samples">
          <div class="section-label">Contoh lokasi</div>
          <button type="button" class="quick-sample-btn" data-lat="-7.5994" data-lon="110.4478">
            <span class="sample-name">Kal. Umbulharjo, Cangkringan</span>
            <span class="sample-meta">-7.5994, 110.4478</span>
          </button>
          <button type="button" class="quick-sample-btn" data-lat="-7.7167" data-lon="110.4186">
            <span class="sample-name">Kal. Wedomartani, Ngemplak</span>
            <span class="sample-meta">-7.7167, 110.4186</span>
          </button>
          <button type="button" class="quick-sample-btn" data-lat="-7.9408" data-lon="110.4247">
            <span class="sample-name">Kal. Mangunan, Dlingo</span>
            <span class="sample-meta">-7.9408, 110.4247</span>
          </button>
        </div>

        <div class="method-note">
          Skor GPKG menggunakan pembobotan lima parameter. Faktor keamanan lereng dihitung
          terpisah dengan metode infinite slope.
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
    const zonaLabel = String(triase.zonaTriase || "Zona").split(" (")[0];

    const parameterRows = [
      {
        key: "lereng",
        label: "Kemiringan tanah",
        symbol: "β",
        bobot: "30%",
        skor: lereng.skor,
        kontribusi: triase.kontribusi.lereng,
        pct: (lereng.skor / 5) * 100,
        color: SCORE_COLORS[lereng.skor] || "#2E7D32",
        desc: `${formatAngka(lereng.derajat, 2)}° / ${formatAngka(lereng.persen, 1)}% · ${lereng.deskripsi}`,
      },
      {
        key: "tanah",
        label: "Jenis dan kondisi tanah",
        symbol: "pedologi",
        bobot: "25%",
        skor: pedologi.skor,
        kontribusi: triase.kontribusi.tanah,
        pct: (pedologi.skor / 5) * 100,
        color: SCORE_COLORS[pedologi.skor] || "#FFB300",
        desc: `${pedologi.nama} · ${pedologi.sifatRingkas}`,
      },
      {
        key: "batuan",
        label: "Jenis batuan",
        symbol: "geologi",
        bobot: "20%",
        skor: litologi.skor,
        kontribusi: triase.kontribusi.batuan,
        pct: (litologi.skor / 5) * 100,
        color: SCORE_COLORS[litologi.skor] || "#66BB6A",
        desc: `${litologi.nama} · ${litologi.litologi}`,
      },
      {
        key: "hujan",
        label: "Curah hujan tahunan",
        symbol: "isohyet",
        bobot: "15%",
        skor: hujan.skor,
        kontribusi: triase.kontribusi.hujan,
        pct: (hujan.skor / 5) * 100,
        color: SCORE_COLORS[hujan.skor] || "#FFB300",
        desc: `${formatAngka(hujan.chMm, 0)} mm/tahun · ${hujan.kelas}`,
      },
      {
        key: "lahan",
        label: "Penggunaan lahan",
        symbol: "tutupan",
        bobot: "10%",
        skor: tutupan.skor,
        kontribusi: triase.kontribusi.lahan,
        pct: (tutupan.skor / 5) * 100,
        color: SCORE_COLORS[tutupan.skor] || "#FFB300",
        desc: `${tutupan.kategori}`,
      },
    ];

    const parameterRowsHtml = parameterRows
      .map(
        (p) => `
        <div class="parameter-item">
          <div class="parameter-head">
            <div class="parameter-name">${p.label} <span>(${p.symbol})</span></div>
            <span class="parameter-meta"><b>${p.skor}</b>/5 · bobot ${p.bobot}</span>
          </div>
          <div class="parameter-track">
            <div class="parameter-fill" style="width:${p.pct}%;background:${p.color};"></div>
          </div>
          <div class="parameter-desc">${p.desc} · kontribusi +${formatAngka(p.kontribusi, 2)}</div>
        </div>
      `
      )
      .join("");

    panel.innerHTML = `
      <section class="inspector-card decision-card" aria-labelledby="sidebar-wilayah-title">
        <div class="decision-topline">
          <span class="decision-topline-label">Ringkasan keputusan</span>
          <span class="zone-chip ${triase.kode}" title="${triase.zonaTriase}">
            <span class="zone-dot" style="background:${triase.hex};"></span>${zonaLabel}
          </span>
        </div>
        <div class="decision-score-band">
          <div class="score-main">
            <span class="score-value">${formatAngka(skorAkhirVal, 2)}</span>
            <span class="score-denom">/ 5,00</span>
          </div>
          <div class="score-caption">
            <b>Skor akhir GPKG</b>
            Pembobotan lima parameter
          </div>
        </div>
        <div class="region-block">
          <h2 class="region-block-title" id="sidebar-wilayah-title">${labelWilayah}</h2>
          <p class="region-block-sub">Permen PU No. 22/PRT/M/2007 &amp; SNI 8291:2016 · Matriks empiris Dasar.xlsx</p>
          <div class="coord-pill-row">
            <div class="coord-pill" title="Koordinat peta WGS 84 (EPSG:4326)">
              <span>WGS 84</span>
              <span class="mono">${info.latWgs84.toFixed(5)}, ${info.lonWgs84.toFixed(5)}</span>
            </div>
            <div class="coord-pill" title="Koordinat metrik UTM Zona 49S (EPSG:32749)">
              <span>UTM 49S</span>
              <span class="mono">${Math.round(info.easting).toLocaleString("id-ID")} mE · ${Math.round(info.northing).toLocaleString("id-ID")} mS</span>
            </div>
          </div>
        </div>
        <div class="metric-grid">
          <div class="metric-cell">
            <span class="metric-label">Elevasi</span>
            <span class="metric-value">${formatAngka(info.elevasiMdpl, 1)} <small>mdpl</small></span>
          </div>
          <div class="metric-cell">
            <span class="metric-label">Kemiringan lereng</span>
            <span class="metric-value">${formatAngka(lereng.derajat, 2)}° <small>β</small></span>
          </div>
          <div class="metric-cell">
            <span class="metric-label">Tanah</span>
            <span class="metric-value">${pedologi.nama}</span>
          </div>
          <div class="metric-cell">
            <span class="metric-label">Litologi</span>
            <span class="metric-value">${litologi.nama}</span>
          </div>
        </div>
      </section>

      <section class="inspector-card slope-card">
        <div class="inspector-card-header">
          <h3>Stabilitas lereng</h3>
          <span class="badge-count">Infinite slope</span>
        </div>
        <div class="inspector-card-body">
          <div class="stability-score-row">
            <div>
              <div class="fs-value" style="color:${fsColor};">${formatAngka(fsInfo.fs, 2)} <small>FS</small></div>
              <div class="fs-label">Faktor keamanan lereng pada titik terpilih</div>
            </div>
            <span class="status-chip ${fsInfo.statusKode}">${fsInfo.status}</span>
          </div>
          <div class="parameter-track" style="margin-bottom:8px;">
            <div class="parameter-fill" style="width:${fsBarPct}%;background:${fsColor};"></div>
          </div>
          <div class="stability-scale">
            <div class="scale-segment">&lt; 1,07<br />labil</div>
            <div class="scale-segment">1,07–1,25<br />kritis</div>
            <div class="scale-segment">&gt; 1,25<br />stabil</div>
          </div>
          <div class="stability-note">${fsInfo.keterangan}</div>
        </div>
      </section>

      <section class="inspector-card">
        <div class="inspector-card-header">
          <h3>Audit trail parameter</h3>
          <span class="badge-count">Dasar.xlsx</span>
        </div>
        <div class="audit-grid">
          <div class="audit-cell">
            <span class="audit-lbl">Kemiringan lereng (β)</span>
            <span class="audit-val">${formatAngka(lereng.derajat, 2)}° (${formatAngka(lereng.persen, 1)}%)</span>
            <span class="audit-sub">DEMNAS</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Kohesi efektif (c′ + c<sub>r</sub>)</span>
            <span class="audit-val">${formatAngka(fsInfo.cPrime, 1)} + ${formatAngka(fsInfo.crKpa, 1)} kPa</span>
            <span class="audit-sub">Tanah dan akar</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Sudut geser dalam (φ′)</span>
            <span class="audit-val">${formatAngka(fsInfo.phiPrime, 1)}°</span>
            <span class="audit-sub">${pedologi.nama}</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Berat isi jenuh (γ<sub>sat</sub>)</span>
            <span class="audit-val">${formatAngka(fsInfo.gammaSat, 1)} kN/m³</span>
            <span class="audit-sub">γ<sub>w</sub> = 9,81 kN/m³</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Kedalaman gelincir (z)</span>
            <span class="audit-val">${formatAngka(fsInfo.zDepth, 2)} m</span>
            <span class="audit-sub">Bidang kontak solum</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Rasio kejenuhan air (m)</span>
            <span class="audit-val">${formatAngka(fsInfo.mRatio, 2)}</span>
            <span class="audit-sub">m = h<sub>w</sub> / z · CH ${formatAngka(hujan.chMm, 0)} mm/tahun</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Tegangan air pori (u)</span>
            <span class="audit-val">${formatAngka(fsInfo.uKpa, 2)} kPa</span>
            <span class="audit-sub">u = m · γ<sub>w</sub> · z</span>
          </div>
          <div class="audit-cell">
            <span class="audit-lbl">Beban tambahan (q)</span>
            <span class="audit-val">${formatAngka(fsInfo.qKpa, 1)} kPa</span>
            <span class="audit-sub">${tutupan.nama}</span>
          </div>
        </div>
      </section>

      <section class="inspector-card">
        <div class="inspector-card-header">
          <h3>Analisis parameter</h3>
          <span class="badge-count">Σ ${formatAngka(skorAkhirVal, 2)}</span>
        </div>
        <div class="parameter-list">
          ${parameterRowsHtml}
        </div>
        <div class="parameter-foot">
          <span>Total skor tertimbang · Σ (skor × bobot)</span>
          <b>${formatAngka(skorAkhirVal, 2)} / 5,00</b>
        </div>
      </section>

      <section class="inspector-card advisory-card">
        <div class="inspector-card-header">
          <h3>Interpretasi dan rekomendasi</h3>
          <span class="badge-count">Engineering advisory</span>
        </div>

        <div class="interpretation-list">
          <div class="interpretation-block diagnosa">
            <div class="interpretation-title">Diagnosa mekanika tanah dan lereng</div>
            <div class="interpretation-text">${aiAdvisor.diagnosa}</div>
          </div>
          <div class="interpretation-block">
            <div class="interpretation-title">Rekomendasi struktur dan pondasi</div>
            <div class="interpretation-text">${aiAdvisor.fondasi}</div>
          </div>
          <div class="interpretation-block mitigasi">
            <div class="interpretation-title">Mitigasi drainase dan perkuatan lereng</div>
            <div class="interpretation-text">${aiAdvisor.mitigasi}</div>
          </div>
        </div>

        <div class="viability-callout ${triase.kode}">
          <div class="viability-label">Status kelayakan pengembangan perumahan</div>
          <div class="viability-value">${aiAdvisor.statusKpr}</div>
          <div class="viability-desc">${aiAdvisor.descKpr}</div>
        </div>

        <div class="method-note">
          Rekomendasi dihasilkan dari klasifikasi skor, kelas lereng, dan Faktor Keamanan
          pada titik yang dipilih. Keputusan akhir tetap memerlukan verifikasi lapangan.
        </div>
      </section>
    `;
  }

  function buatPopupRingkas(info) {
    const { triase, lereng, pedologi } = info;
    const labelWilayah = `Kal. ${info.kalurahan}, Kapanewon ${info.kapanewon}, ${info.kabupaten}`;
    return `
      <div class="map-popup">
        <div class="map-popup-head">
          <span class="zone-chip ${triase.kode}"><span class="zone-dot" style="background:${triase.hex};"></span>${triase.badge}</span>
        </div>
        <h3 class="map-popup-title">${labelWilayah}</h3>
        <p class="map-popup-coord">WGS 84 ${info.latWgs84.toFixed(5)}, ${info.lonWgs84.toFixed(5)}</p>
        <dl class="map-popup-grid">
          <div>
            <dt>Skor GPKG</dt>
            <dd>${formatAngka(triase.skorAkhir, 2)}</dd>
          </div>
          <div>
            <dt>Kemiringan</dt>
            <dd>${formatAngka(lereng.derajat, 2)}° (${formatAngka(lereng.persen, 1)}%)</dd>
          </div>
          <div>
            <dt>Infinite slope FS</dt>
            <dd style="color:${triase.fsInfo.warnaHex};">${formatAngka(triase.fsInfo.fs, 2)} · ${triase.fsInfo.status}</dd>
          </div>
          <div>
            <dt>Parameter tanah</dt>
            <dd>${pedologi.nama}</dd>
          </div>
        </dl>
        <p class="map-popup-note">
          c′ ${pedologi.cPrime} kPa · φ′ ${pedologi.phiPrime}° · γ<sub>sat</sub> ${pedologi.gammaSat} kN/m³
        </p>
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
    bukaDrawerInspeksiJikaMobile();

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

          const apiSkor = (bData.skor_internal && bData.skor_internal.skor_akhir != null)
            ? bData.skor_internal.skor_akhir
            : bData.triase.skor_akhir;
          if (apiSkor !== undefined && apiSkor !== null) {
            terapkanZonaSkor(info.triase, apiSkor);
            if (bData.triase.warna_hex) info.triase.hex = bData.triase.warna_hex;
            if (bData.triase.zona_kode) {
              info.triase.zonaKode = bData.triase.zona_kode;
              info.triase.namaZona = bData.triase.zona || info.triase.namaZona;
              info.triase.zonaTriase = `${bData.triase.zona_kode} (${bData.triase.rekomendasi || info.triase.deskripsi})`;
            }
            if (bData.triase.badge) info.triase.badge = bData.triase.badge;
            if (bData.triase.rekomendasi) info.triase.deskripsi = bData.triase.rekomendasi;
          }
          if (bData.triase.fs !== undefined && bData.triase.fs !== null) {
            terapkanFsInfo(
              info.triase,
              bData.triase.fs,
              bData.triase.fs_label,
              bData.triase.fs_warna_hex,
              bData.triase.fs_desc
            );
          }
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
    state.activeKavlingGeometry = null;
    state.segmentLayersById = {};
    state.selectedFeature = null;
    state.inspectHighlightGroup.clearLayers();
    state.kavlingSegmentGroup.clearLayers();
    state.kavlingOutlineGroup.clearLayers();
    resetSpkMapState();
    map.closePopup();
    if (state.layers.admin) {
      state.layers.admin.setStyle(styleBatasAdmin);
    }
    sinkronStatusTombolGambar(false, false);
    renderEmptyStateSidebar();
    if (window.LahanAmanSPKUI) {
      window.LahanAmanSPKUI.handlePolygonCleared();
    }
  }

  // =========================================================================
  // 11. PEMOTONGAN POLIGON KAVLING & SEGMENTASI GEOTEKNIK
  // =========================================================================
  const KAVLING_ZONE_STYLE = {
    Hijau: { fill: "#2E7D32", border: "#1B5E20", opacity: 0.58 },
    Kuning: { fill: "#FB8C00", border: "#E65100", opacity: 0.58 },
    Merah: { fill: "#D32F2F", border: "#B71C1C", opacity: 0.58 },
  };

  const SPK_CUSTOM_RAMP = [
    { max: 1.8, fill: "#DBEAFE", border: "#60A5FA" },
    { max: 2.6, fill: "#93C5FD", border: "#3B82F6" },
    { max: 3.4, fill: "#60A5FA", border: "#2563EB" },
    { max: 4.2, fill: "#3B82F6", border: "#1D4ED8" },
    { max: Infinity, fill: "#1D4ED8", border: "#1E3A8A" },
  ];

  const DEMO_POLYGON_WGS84 = {
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

  function warnaIndeksKustom(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) {
      return { fill: "#E2E8F0", border: "#94A3B8" };
    }
    return SPK_CUSTOM_RAMP.find((entry) => n <= entry.max) || SPK_CUSTOM_RAMP[SPK_CUSTOM_RAMP.length - 1];
  }

  function tentukanGayaSegmenAktif(props, segId) {
    if (state.spkAssessment && state.spkAssessment.active) {
      const active = state.spkAssessment.active;
      if (active.profile === "custom") {
        const row = (state.spkAssessment.segments || []).find((item) => item.segmentId === segId);
        if (row && row.activeScore != null) {
          const ramp = warnaIndeksKustom(row.activeScore);
          return { fill: ramp.fill, border: ramp.border, opacity: 0.58 };
        }
      }
    }
    return tentukanGayaSegmen(props);
  }

  function tentukanGayaSegmen(props) {
    if (props && props.warna_hex && props.border_hex) {
      return { fill: props.warna_hex, border: props.border_hex, opacity: 0.58 };
    }
    const zText = String((props && (props.zona_triase || props.kategori_zona)) || "").toUpperCase();
    if (zText.includes("MERAH")) return KAVLING_ZONE_STYLE.Merah;
    if (zText.includes("KUNING")) return KAVLING_ZONE_STYLE.Kuning;
    return KAVLING_ZONE_STYLE.Hijau;
  }

  function buatTooltipSegmen(props, activeRow) {
    const p = props || {};
    const segId = p.segmen_id || (activeRow && activeRow.segmentId) || "SEG-01";
    const zonaLabel = p.zona_singkat || p.zona_triase || "Zona GPKG";
    const active = state.spkAssessment && state.spkAssessment.active;
    const custom = active && active.profile === "custom" && activeRow && activeRow.activeScore != null;
    const st = custom
      ? warnaIndeksKustom(activeRow.activeScore)
      : tentukanGayaSegmen(p);
    const heading = custom
      ? "Indeks kustom " + formatAngka(activeRow.activeScore, 2)
      : zonaLabel;
    const activeRowHtml = custom
      ? `<div><dt>Skor aktif</dt><dd>${formatAngka(activeRow.activeScore, 2)}</dd></div>`
      : "";
    return `
      <div class="segment-tooltip">
        <div class="segment-tooltip-head">
          <span>${segId} · ${heading}</span>
          <span class="zone-dot" style="background:${st.fill};"></span>
        </div>
        <dl class="segment-tooltip-grid">
          <div><dt>Luas</dt><dd>${formatAngka(p.luas_m2, 1)} m² (${formatAngka(p.persen_luas, 1)}%)</dd></div>
          <div><dt>Lereng</dt><dd>${formatAngka(p.beta_mean, 2)}°</dd></div>
          <div><dt>FS</dt><dd>${formatAngka(p.fs, 2)} · ${p.fs_label || "STABIL"}</dd></div>
          ${activeRowHtml}
        </dl>
      </div>
    `;
  }

  function pasangTooltipSegmen(layer, activeRow) {
    if (!layer || !layer.feature) return;
    const html = buatTooltipSegmen(layer.feature.properties || {}, activeRow);
    const tooltip = layer.getTooltip ? layer.getTooltip() : null;
    if (tooltip && typeof tooltip.setContent === "function") {
      tooltip.setContent(html);
      return;
    }
    layer.bindTooltip(html, {
      sticky: true,
      direction: "top",
      className: "kavling-seg-tooltip",
    });
  }

  function gambarBatasKavlingDiPeta(geometry) {
    state.kavlingOutlineGroup.clearLayers();
    if (!geometry) return;
    L.geoJSON(geometry, {
      interactive: false,
      style: {
        color: "#0F172A",
        weight: 2.2,
        opacity: 0.9,
        dashArray: "7 5",
        fill: false,
      },
    }).addTo(state.kavlingOutlineGroup);
  }

  function setSpkLayerControlState(key, available, reason) {
    const checkbox = document.getElementById("chk-spk-" + (key === "landUse" ? "land-use" : key));
    const card = document.querySelector('[data-spk-layer-card="' + key + '"]');
    if (checkbox) {
      checkbox.disabled = !available;
      if (!available) checkbox.checked = false;
      checkbox.title = available ? "" : reason || "Layer belum tersedia.";
    }
    if (card) {
      card.classList.toggle("is-unavailable", !available);
      card.classList.remove("is-active");
    }
  }

  function clearSpkSpatialLayers() {
    [
      state.spkLandUseGroup,
      state.spkSensitiveGroup,
      state.spkLegalGroup,
    ].forEach((group) => {
      if (!group) return;
      group.clearLayers();
      if (map.hasLayer(group)) map.removeLayer(group);
    });
    state.spkLandUseReport = null;
    state.spkSensitiveReport = null;
    if (
      state.activeLegendMode === "spk-land-use" ||
      state.activeLegendMode === "spk-sensitive"
    ) {
      state.activeLegendMode =
        state.spkSpatialLegendBefore || (state.spkAssessment ? "spk" : "triase");
      state.spkSpatialLegendBefore = null;
      updateLegend();
    }
    setSpkLayerControlState("landUse", false, "Tersedia setelah analisis kavling.");
    setSpkLayerControlState("sensitive", false, "Tersedia setelah analisis kavling.");
    setSpkLayerControlState("legal", false, "Dataset pembatas legal resmi belum tersedia.");
  }

  function renderSpkSpatialLayers(data) {
    clearSpkSpatialLayers();
    if (!data) return;
    const landUseApi = window.LahanAmanLandUse;
    const sensitiveApi = window.LahanAmanSensitiveAreas;
    if (!landUseApi || !sensitiveApi) return;

    const landUse = landUseApi.normalize(data.land_use);
    state.spkLandUseReport = landUse;
    landUse.features.forEach((feature) => {
      if (!feature.geometry) return;
      const layer = L.geoJSON(feature.geometry, {
        pane: "spkLandUsePane",
        renderer: spkLandUseRenderer,
        style: () => landUseApi.styleForFeature(feature, 0.3),
      });
      const tooltip =
        "<b>" +
        feature.className +
        "</b><br>" +
        landUseApi.formatArea(feature.areaM2) +
        " · " +
        landUseApi.formatPercent(feature.percentOfPolygon) +
        " poligon";
      layer.bindTooltip(tooltip, { sticky: true });
      state.spkLandUseGroup.addLayer(layer);
    });
    const hasLandUse = landUse.features.length > 0;
    setSpkLayerControlState(
      "landUse",
      hasLandUse,
      "Tidak ada geometri guna lahan pada area analisis."
    );

    const sensitive = sensitiveApi.normalize(data.sensitive_areas);
    state.spkSensitiveReport = sensitive;
    sensitive.features.forEach((feature) => {
      if (!feature.geometry) return;
      const layer = L.geoJSON(feature.geometry, {
        pane: "spkSensitivePane",
        renderer: spkSensitiveRenderer,
        style: () => sensitiveApi.styleForFeature(feature, 0.2),
      });
      const tooltip =
        "<b>" +
        feature.label +
        "</b><br>" +
        (feature.sourceClass || "-") +
        " · indikasi";
      layer.bindTooltip(tooltip, { sticky: true });
      state.spkSensitiveGroup.addLayer(layer);
    });
    const hasSensitive = sensitive.features.length > 0;
    setSpkLayerControlState(
      "sensitive",
      hasSensitive,
      "Tidak ada objek/kawasan sensitif pada data tersedia."
    );
    setSpkLayerControlState("legal", false, "Dataset pembatas legal resmi belum tersedia.");
  }

  function toggleSpkLayer(key, checked) {
    const mapByKey = {
      landUse: state.spkLandUseGroup,
      sensitive: state.spkSensitiveGroup,
      legal: state.spkLegalGroup,
    };
    const group = mapByKey[key];
    if (!group) return;
    const card = document.querySelector('[data-spk-layer-card="' + key + '"]');
    const legendByKey = {
      landUse: "spk-land-use",
      sensitive: "spk-sensitive",
    };
    const legendMode = legendByKey[key];
    if (checked && group.getLayers().length) {
      group.addTo(map);
      if (card) card.classList.add("is-active");
      if (legendMode) {
        if (
          state.activeLegendMode !== "spk-land-use" &&
          state.activeLegendMode !== "spk-sensitive"
        ) {
          state.spkSpatialLegendBefore = state.activeLegendMode;
        }
        state.activeLegendMode = legendMode;
        updateLegend();
      }
    } else {
      if (map.hasLayer(group)) map.removeLayer(group);
      if (card) card.classList.remove("is-active");
      if (checked) {
        const checkbox = document.getElementById("chk-spk-" + (key === "landUse" ? "land-use" : key));
        if (checkbox) checkbox.checked = false;
      }
      if (legendMode && state.activeLegendMode === legendMode) {
        const otherKey = key === "landUse" ? "sensitive" : "landUse";
        const otherGroup = mapByKey[otherKey];
        const otherLegend = legendByKey[otherKey];
        if (otherGroup && otherLegend && map.hasLayer(otherGroup) && otherGroup.getLayers().length) {
          state.activeLegendMode = otherLegend;
        } else if (state.spkSpatialLegendBefore) {
          state.activeLegendMode = state.spkSpatialLegendBefore;
          state.spkSpatialLegendBefore = null;
        } else {
          state.activeLegendMode = state.spkAssessment ? "spk" : "triase";
        }
        updateLegend();
      }
    }
  }

  function resetSpkMapState() {
    clearSpkSpatialLayers();
    state.spkAssessment = null;
    if (state.spkLegendBefore) {
      state.activeLegendMode = state.spkLegendBefore;
      state.spkLegendBefore = null;
    } else if (state.activeLegendMode === "spk") {
      state.activeLegendMode = "triase";
    }
    Object.keys(state.segmentLayersById).forEach((segId) => {
      const layer = state.segmentLayersById[segId];
      if (!layer || !layer.feature) return;
      const st = tentukanGayaSegmen(layer.feature.properties || {});
      layer.setStyle({
        color: st.border,
        weight: 2.4,
        fillColor: st.fill,
        fillOpacity: 0.58,
      });
      pasangTooltipSegmen(layer, null);
    });
    const badge = document.getElementById("spk-map-badge");
    if (badge) badge.hidden = true;
    updateLegend();
  }

  function applySpkAssessment(assessment) {
    if (!assessment) {
      resetSpkMapState();
      return;
    }
    if (!state.spkLegendBefore) {
      const previous = state.activeLegendMode;
      state.spkLegendBefore =
        previous === "spk" || previous === "spk-land-use" || previous === "spk-sensitive"
          ? "triase"
          : previous;
    }
    state.spkAssessment = assessment;
    state.activeLegendMode = "spk";
    updateLegend();

    const badge = document.getElementById("spk-map-badge");
    const badgeText = document.getElementById("spk-map-badge-text");
    if (badge && badgeText) {
      const custom = assessment.active && assessment.active.profile === "custom";
      badgeText.textContent = custom
        ? "SPK aktif • indeks kustom belum terkalibrasi"
        : "SPK aktif • " + (assessment.active ? assessment.active.label : "WLC standar");
      badge.hidden = false;
    }

    (assessment.segments || []).forEach((row) => {
      const layer = state.segmentLayersById[row.segmentId];
      if (!layer) return;
      const props = (layer.feature && layer.feature.properties) || {};
      const st = tentukanGayaSegmenAktif(props, row.segmentId);
      layer.setStyle({
        color: st.border,
        weight: 2.4,
        fillColor: st.fill,
        fillOpacity: 0.58,
      });
      pasangTooltipSegmen(layer, row);
    });
  }

  function sinkronStatusTombolGambar(isDrawing, hasResult) {
    const btnMain = document.getElementById("btn-draw-kavling");
    const btnTop = document.getElementById("btn-draw-kavling-top");
    const btnResetMap = document.getElementById("btn-reset-kavling-map");
    const btnCancel = document.getElementById("btn-cancel-draw");
    const iconPolygon = '<svg class="icon" aria-hidden="true"><use href="#icon-polygon"></use></svg>';

    if (btnMain) {
      if (isDrawing) {
        btnMain.classList.add("is-drawing");
        btnMain.innerHTML = `${iconPolygon}<span>Batalkan gambar</span>`;
      } else {
        btnMain.classList.remove("is-drawing");
        btnMain.innerHTML = `${iconPolygon}<span>Gambar poligon</span>`;
      }
    }
    if (btnTop) {
      if (isDrawing) {
        btnTop.classList.add("active");
        btnTop.innerHTML = `${iconPolygon}Batal gambar`;
      } else {
        btnTop.classList.remove("active");
        btnTop.innerHTML = `${iconPolygon}Gambar Kavling`;
      }
    }
    if (btnCancel) {
      btnCancel.disabled = !isDrawing;
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
    setLoading("Klik titik sudut poligon kavling di peta, lalu klik titik awal untuk menyelesaikan.");

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
      <div class="kavling-loading">
        <div class="spinner"></div>
        <div class="kavling-loading-title">Memproses segmentasi kavling</div>
        <div class="kavling-loading-text">
          Poligon dipotong terhadap zona kerawanan GPKG, lalu dihitung kemiringan
          DEMNAS dan Faktor Keamanan infinite slope per segmen.
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
        const segId = p.segmen_id || "SEG-01";

        state.segmentLayersById[segId] = layer;

        pasangTooltipSegmen(layer, null);

        layer.on("mouseover", () => {
          layer.setStyle({ weight: 3.6, fillOpacity: 0.78 });
          if (layer.bringToFront) layer.bringToFront();
        });

        layer.on("mouseout", () => {
          const activeStyle = tentukanGayaSegmenAktif(p, segId);
          layer.setStyle({
            color: activeStyle.border,
            weight: 2.4,
            fillColor: activeStyle.fill,
            fillOpacity: 0.58,
          });
        });

        layer.on("click", () => {
          if (window.LahanAmanSPKUI) {
            window.LahanAmanSPKUI.selectSegment(segId, { fromMap: true });
          }
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
    let luasPoligon = Number(summary.luas_poligon_m2);
    if (!Number.isFinite(luasPoligon) || luasPoligon <= 0) {
      luasPoligon = totalLuas;
    }
    const persenCakupan = Number(summary.persen_cakupan);
    const cakupanAngka = Number.isFinite(persenCakupan)
      ? persenCakupan
      : (totalLuas / luasPoligon) * 100;
    const cakupanLabel = formatAngka(cakupanAngka, 1);
    const cakupanRendah = cakupanAngka < 80;

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
      <section class="kavling-summary">
        <div class="kavling-summary-top">
          <h3>Hasil segmentasi kavling</h3>
          <span class="mono">EPSG:32749</span>
        </div>

        <div class="kavling-area">
          <span class="kavling-area-label">Luas poligon kavling</span>
          <div class="kavling-area-value">${formatAngka(luasPoligon, 1)} <small>m�</small></div>
          <div class="kavling-area-sub">
            � ${formatAngka(luasPoligon / 10000, 3)} ha � ${features.length} segmen spasial � cakupan data ${cakupanLabel}%
          </div>
          <div class="kavling-coverage-note ${cakupanRendah ? "is-low" : ""}">
            ${cakupanRendah ? "Sebagian poligon tidak tercakup layer kerawanan. Area yang tidak tercakup tidak boleh dianggap aman." : "Cakupan layer kerawanan memadai untuk evaluasi awal."}
          </div>
        </div>
        </div>

        <div class="kavling-kpis">
          <div class="kavling-kpi">
            <span class="kavling-kpi-label">Segmen</span>
            <span class="kavling-kpi-value">${features.length}</span>
          </div>
          <div class="kavling-kpi">
            <span class="kavling-kpi-label">Rerata lereng</span>
            <span class="kavling-kpi-value">${formatAngka(betaKavling, 2)}°</span>
          </div>
          <div class="kavling-kpi">
            <span class="kavling-kpi-label">Zona dominan</span>
            <span class="kavling-kpi-value">${pctMerah >= pctKuning && pctMerah >= pctHijau ? "Merah" : pctKuning >= pctHijau ? "Kuning" : "Hijau"}</span>
          </div>
        </div>

        <div class="zone-distribution">
          <div class="stacked-bar" title="Proporsi luas kelas skoring GPKG">
            <div class="stacked-seg hijau" style="width:${pctHijau}%;"></div>
            <div class="stacked-seg kuning" style="width:${pctKuning}%;"></div>
            <div class="stacked-seg merah" style="width:${pctMerah}%;"></div>
          </div>
          <div class="zone-legend">
            <span><span class="zone-dot hijau"></span>Hijau <b>${formatAngka(pctHijau, 1)}%</b></span>
            <span><span class="zone-dot kuning"></span>Kuning <b>${formatAngka(pctKuning, 1)}%</b></span>
            <span><span class="zone-dot merah"></span>Merah <b>${formatAngka(pctMerah, 1)}%</b></span>
          </div>
        </div>
      </section>

      <section class="inspector-card">
        <div class="inspector-card-header">
          <h3>Matriks segmen kavling</h3>
          <span class="badge-count">${features.length} segmen</span>
        </div>
        <div class="segment-table-wrap">
          <table class="segment-table">
            <thead>
              <tr>
                <th>Segmen / zona</th>
                <th style="text-align:right;">Luas (m²)</th>
                <th style="text-align:right;">Porsi</th>
                <th style="text-align:right;">β</th>
                <th style="text-align:right;">FS</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </section>

      <details class="kavling-audit">
        <summary>Audit trail parameter segmen · Dasar.xlsx</summary>
        <div class="kavling-audit-body">
          ${features
            .map((f) => {
              const p = f.properties || {};
              return `
                <div class="segment-audit-row">
                  <span><b>${p.segmen_id}</b> · ${p.zona_triase || "-"}</span>
                  <span class="mono">c′ ${formatAngka(p.c_kpa, 1)} · φ′ ${formatAngka(p.phi_deg, 1)}° · m ${formatAngka(p.rasio_m, 2)} · FS ${formatAngka(p.fs, 2)}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </details>

      <section class="kavling-spk-cta">
        <div>
          <span class="kavling-spk-cta-eyebrow">Spatial decision support</span>
          <b>Analisis SPK</b>
          <p>Uji bobot WLC, baca FS terpisah, cek pembatas, dan catat keputusan pengguna.</p>
        </div>
        <button type="button" class="btn btn-primary" id="btn-open-spk-panel">
          <svg class="icon" aria-hidden="true"><use href="#icon-sliders"></use></svg>Buka SPK
        </button>
      </section>

      <div class="kavling-actions">
        <button type="button" class="btn btn-primary" id="btn-redraw-kavling-panel">
          <svg class="icon" aria-hidden="true"><use href="#icon-polygon"></use></svg>Gambar ulang
        </button>
        <button type="button" class="btn btn-secondary" id="btn-reset-kavling-panel">
          <svg class="icon" aria-hidden="true"><use href="#icon-reset"></use></svg>Reset kavling
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
        const st = tentukanGayaSegmenAktif(p, segId);
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
        if (window.LahanAmanSPKUI) {
          window.LahanAmanSPKUI.selectSegment(segId, { fromTable: true });
        }
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

    const btnOpenSpkPanel = document.getElementById("btn-open-spk-panel");
    if (btnOpenSpkPanel) {
      btnOpenSpkPanel.addEventListener("click", () => {
        if (window.LahanAmanSPKUI) {
          window.LahanAmanSPKUI.open({ source: "polygon" });
        }
      });
    }
  }

  async function prosesAnalisisKavling(geojsonGeometry) {
    try {
      state.selectedFeature = null;
      state.activeKavlingResult = null;
      state.segmentLayersById = {};
      state.inspectHighlightGroup.clearLayers();
      state.kavlingSegmentGroup.clearLayers();
      state.kavlingOutlineGroup.clearLayers();
      state.activeKavlingGeometry = geojsonGeometry;
      resetSpkMapState();
      gambarBatasKavlingDiPeta(geojsonGeometry);
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
      state.activeKavlingGeometry = geojsonGeometry;
      sinkronStatusTombolGambar(false, true);
      renderSegmenKavlingDiPeta(data);
      renderPanelSegmenKavling(data);
      if (window.LahanAmanSPKUI) {
        window.LahanAmanSPKUI.notifyPolygonUpdated(data);
      }
      renderSpkSpatialLayers(data);
      bukaDrawerInspeksiJikaMobile();
      setLoading(null);
    } catch (err) {
      console.error("[KAVLING ANALYZER ERROR]", err);
      state.activeKavlingGeometry = null;
      state.kavlingOutlineGroup.clearLayers();
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

    if (state.activeLegendMode === "spk" && state.spkAssessment) {
      const assessment = state.spkAssessment;
      const custom = assessment.active && assessment.active.profile === "custom";
      if (custom) {
        el.innerHTML = `
          <div class="legend-title">SPK aktif � indeks kustom (belum terkalibrasi)</div>
          <div class="legend-row"><span class="legend-swatch" style="background:${SPK_CUSTOM_RAMP[0].fill};border:1px solid ${SPK_CUSTOM_RAMP[0].border};"></span><span><b>1,00 � 1,80</b> kontribusi rendah</span></div>
          <div class="legend-row"><span class="legend-swatch" style="background:${SPK_CUSTOM_RAMP[1].fill};border:1px solid ${SPK_CUSTOM_RAMP[1].border};"></span><span><b>&gt;1,80 � 2,60</b></span></div>
          <div class="legend-row"><span class="legend-swatch" style="background:${SPK_CUSTOM_RAMP[2].fill};border:1px solid ${SPK_CUSTOM_RAMP[2].border};"></span><span><b>&gt;2,60 � 3,40</b></span></div>
          <div class="legend-row"><span class="legend-swatch" style="background:${SPK_CUSTOM_RAMP[3].fill};border:1px solid ${SPK_CUSTOM_RAMP[3].border};"></span><span><b>&gt;3,40 � 4,20</b></span></div>
          <div class="legend-row"><span class="legend-swatch" style="background:${SPK_CUSTOM_RAMP[4].fill};border:1px solid ${SPK_CUSTOM_RAMP[4].border};"></span><span><b>&gt;4,20 � 5,00</b> kontribusi tinggi</span></div>
          <div class="legend-note">Skala indeks kustom bukan Zona Hijau/Kuning/Merah. FS tetap terpisah.</div>
        `;
      } else {
        el.innerHTML = `
          <div class="legend-title">SPK aktif � profil riset standar</div>
          <div class="legend-row"><span class="legend-swatch" style="background:#10b981;"></span><span><b>Zona Hijau</b> skor &lt; 2,20</span></div>
          <div class="legend-row"><span class="legend-swatch" style="background:#f59e0b;"></span><span><b>Zona Kuning</b> skor 2,20 � 3,40</span></div>
          <div class="legend-row"><span class="legend-swatch" style="background:#ef4444;"></span><span><b>Zona Merah</b> skor &gt; 3,40</span></div>
          <div class="legend-note">Infinite Slope FS ditampilkan terpisah dan tidak digabung ke WLC.</div>
        `;
      }
      return;
    }

    if (state.activeLegendMode === "spk-land-use") {
      const report = state.spkLandUseReport;
      const classes = report ? report.classes.slice(0, 5) : [];
      const landUseApi = window.LahanAmanLandUse;
      const rows = classes
        .map((item) => {
          const percentText = landUseApi
            ? landUseApi.formatPercent(item.percentOfPolygon)
            : "-";
          return `
            <div class="legend-row">
              <span class="legend-swatch" style="background:${item.color};border:1px solid #1e293b;"></span>
              <span><b>${escapeLegendText(item.className)}</b> ${percentText} poligon</span>
            </div>
          `;
        })
        .join("");
      const remaining = report && report.classes.length > classes.length
        ? `<div class="legend-note">${report.classes.length - classes.length} kelas lain tersedia pada tabel analisis.</div>`
        : "";
      el.innerHTML = `
        <div class="legend-title">Guna lahan - informasi sumber</div>
        ${rows || '<div class="legend-note">Tidak ada kelas guna lahan pada area analisis.</div>'}
        ${remaining}
        <div class="legend-note">Warna mengikuti atribut sumber. Kelas guna lahan bukan status hukum.</div>
      `;
      return;
    }

    if (state.activeLegendMode === "spk-sensitive") {
      const report = state.spkSensitiveReport;
      const items = report ? report.items.slice(0, 5) : [];
      const rows = items
        .map((item) => `
          <div class="legend-row">
            <span class="legend-swatch" style="background:${item.color};border:2px dashed #0f172a;"></span>
            <span><b>${escapeLegendText(item.label)}</b> - indikasi</span>
          </div>
        `)
        .join("");
      const remaining = report && report.items.length > items.length
        ? `<div class="legend-note">${report.items.length - items.length} objek/kawasan lain tersedia pada tabel analisis.</div>`
        : "";
      el.innerHTML = `
        <div class="legend-title">Objek dan kawasan sensitif - indikasi</div>
        ${rows || '<div class="legend-note">Tidak ada objek/kawasan sensitif teridentifikasi.</div>'}
        ${remaining}
        <div class="legend-note">Garis putus-putus pada peta menandai indikasi. Status dan batas resmi belum diverifikasi.</div>
      `;
      return;
    }

    if (state.activeLegendMode === "lereng") {
      el.innerHTML = `
        <div class="legend-title">Kemiringan lereng · DEMNAS · bobot 30%</div>
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
        <div class="legend-title">Litologi dan formasi geologi · bobot 20%</div>
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
        <div class="legend-title">Karakteristik tanah · pedologi · bobot 25%</div>
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
        <div class="legend-title">Curah hujan tahunan · isohyet · bobot 15%</div>
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
        <div class="legend-title">Tutupan lahan · RBI 25K · bobot 10%</div>
        <div class="legend-row"><span class="legend-swatch" style="background:#D32F2F;"></span><span><b>Skor 5</b>: Tanah Terbuka / Tambang / Tegalan / Sawah &gt;8° (cr=0, q=0)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:#FB8C00;"></span><span><b>Skor 4</b>: Semak Belukar / Alang-alang (cr=0,5 kPa, q=0)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:#FFB300;"></span><span><b>Skor 3</b>: Permukiman / Bangunan / Jalan (cr=0, q=15 kPa)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:#66BB6A;"></span><span><b>Skor 2</b>: Perkebunan / Kebun Campuran (cr=3,5 kPa, q=0)</span></div>
        <div class="legend-row"><span class="legend-swatch" style="background:#2E7D32;"></span><span><b>Skor 1</b>: Hutan Lahan Kering / Lindung / Air (cr=10 kPa, q=0)</span></div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="legend-title">Zona kelayakan GPKG · Permen PU 22/2007</div>
      <div class="legend-note">
        <b>Skor akhir</b> = 0,30 lereng + 0,25 tanah + 0,20 batuan + 0,15 hujan + 0,10 lahan
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
    const lbl = document.getElementById(`opacity-lbl-${layerKey}`);
    if (lbl) lbl.textContent = `${pct}%`;

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

  function perbaruiJumlahLayerAktif() {
    const badge = document.getElementById("active-layer-count");
    if (!badge) return;
    const total = document.querySelectorAll(".layer-list input[type='checkbox']:checked").length;
    badge.textContent = `${total} aktif`;
  }

  function sinkronTampilanToggleLayer(layerKey, isChecked) {
    const item = document.getElementById(`sb-card-${layerKey}`);
    if (!item) {
      perbaruiJumlahLayerAktif();
      return;
    }

    item.classList.toggle("is-active", Boolean(isChecked));
    if (isChecked && item.querySelector(".layer-opacity")) {
      item.classList.add("is-open");
    } else if (!isChecked) {
      item.classList.remove("is-open");
    }

    const configBtn = item.querySelector("[data-layer-config]");
    if (configBtn) {
      configBtn.setAttribute("aria-expanded", String(item.classList.contains("is-open")));
    }

    perbaruiJumlahLayerAktif();
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
      setLoading("Memuat pipeline data geospasial dan matriks Dasar.xlsx DIY...");
      perbaruiJumlahLayerAktif();

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

      try {
        const krData = await fetchGeoJSON("clean_kerawanan_longsor.geojson");
        state.kerawananFeatures = krData ? krData.features || [] : [];
      } catch (_ekr) {
        state.kerawananFeatures = [];
      }

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
              `<b>${infoLito.nama}</b><br><span style="font-size:11px;">Skor geologi: <b>${infoLito.skor}/5</b> · ${infoLito.litologi}</span>`,
              { sticky: true }
            );
            layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, feature.properties));
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
              `<b>${infoTanah.nama}</b><br><span style="font-size:11px;">Skor tanah: <b>${infoTanah.skor}/5</b> · ${infoTanah.sifatRingkas}</span>`,
              { sticky: true }
            );
            layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, feature.properties));
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
            `<b>Curah hujan tahunan (isohyet): ${formatAngka(infoHujan.chMm, 0)} mm/tahun</b><br><span style="font-size:11px;">Skor hujan: <b>${infoHujan.skor}/5</b> · rasio kejenuhan m = <b>${formatAngka(infoHujan.mRatio, 2)}</b></span>`,
            { sticky: true }
          );
          layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, feature.properties));
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
            `<b>Pos hujan: ${p.nama_pos || "BBWS Serayu Opak"}</b><br><span style="font-size:11px;">Curah hujan tahunan: <b>${formatAngka(p.curah_hujan_mm, 0)} mm/tahun</b></span>`,
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
      setLoading("Gagal memuat dataset spasial DIY.");
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
            `<b>Skor GPKG ${skorAkhir} / 5,00 · FS ${fsVal} (${fp.fs_label || "STABIL"})</b><br><span style="font-size:11px;"><b>${statusZona}</b><br>Lereng ${fp.skor_lereng ?? "-"} (${fp.lereng_derajat ?? "-"}°) · Tanah ${fp.skor_tanah ?? "-"} · Batuan ${fp.skor_batuan ?? "-"} · Hujan ${fp.skor_hujan ?? "-"} · Lahan ${fp.skor_lahan ?? "-"}</span>`,
            { sticky: true }
          );
          layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, feature.properties));
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
            `<b>Tutupan lahan: ${namaPl}</b><br><span style="font-size:11px;">Skor lahan: <b>${tu.skor}/5</b> (bobot 10%) · cr ${tu.crKpa} kPa · q ${tu.qKpa} kPa</span>`,
            { sticky: true }
          );
          layer.on("click", (ev) => inspeksiTitikPeta(ev.latlng, feature.properties));
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

  const btnCancelDraw = document.getElementById("btn-cancel-draw");
  if (btnCancelDraw) {
    btnCancelDraw.addEventListener("click", (e) => {
      L.DomEvent.stopPropagation(e);
      if (map.pm && map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
      state.isDrawingKavling = false;
      sinkronStatusTombolGambar(false, Boolean(state.activeKavlingResult));
      setLoading(null);
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
      prosesAnalisisKavling(DEMO_POLYGON_WGS84);
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

  // Panel kiri: collapse pada desktop, drawer pada tablet/mobile
  const workspaceEl = document.getElementById("workspace");
  const drawerBackdrop = document.getElementById("drawer-backdrop");
  const btnToggleLayerPanel = document.getElementById("btn-toggle-layer-panel");
  const btnOpenFilters = document.getElementById("btn-open-filters");
  const btnOpenInspector = document.getElementById("btn-open-inspector");
  const btnCloseFilters = document.getElementById("btn-close-filters");
  const btnCloseInspector = document.getElementById("btn-close-inspector");

  function layoutMobile() {
    return window.matchMedia("(max-width: 1180px)").matches;
  }

  function bukaDrawer(sisi) {
    if (!layoutMobile()) return;
    document.body.classList.toggle("drawer-left-open", sisi === "left");
    document.body.classList.toggle("drawer-right-open", sisi === "right");
    if (drawerBackdrop) drawerBackdrop.hidden = false;
  }

  function tutupDrawer() {
    document.body.classList.remove("drawer-left-open", "drawer-right-open");
    if (drawerBackdrop) drawerBackdrop.hidden = true;
  }

  function bukaDrawerInspeksiJikaMobile() {
    bukaDrawer("right");
  }

  if (btnToggleLayerPanel) {
    btnToggleLayerPanel.addEventListener("click", () => {
      if (layoutMobile()) {
        if (document.body.classList.contains("drawer-left-open")) {
          tutupDrawer();
        } else {
          bukaDrawer("left");
        }
        return;
      }
      if (!workspaceEl) return;
      const collapsed = workspaceEl.classList.toggle("is-left-collapsed");
      btnToggleLayerPanel.setAttribute("aria-pressed", String(collapsed));
      setTimeout(() => map.invalidateSize(), 220);
    });
  }

  if (btnOpenFilters) {
    btnOpenFilters.addEventListener("click", () => bukaDrawer("left"));
  }
  if (btnOpenInspector) {
    btnOpenInspector.addEventListener("click", () => bukaDrawer("right"));
  }
  if (btnCloseFilters) btnCloseFilters.addEventListener("click", tutupDrawer);
  if (btnCloseInspector) btnCloseInspector.addEventListener("click", tutupDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", tutupDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") tutupDrawer();
  });

  window.addEventListener("resize", () => {
    if (!layoutMobile()) tutupDrawer();
  });

  // Kontrol buka/tutup opasitas tiap layer
  document.querySelectorAll("[data-layer-config]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".layer-item");
      if (!item) return;
      const open = item.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", String(open));
    });
  });

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

  // Checkbox Layer Informasi SPK
  document.querySelectorAll("[data-spk-layer]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const key = e.target.getAttribute("data-spk-layer");
      toggleSpkLayer(key, e.target.checked);
      perbaruiJumlahLayerAktif();
    });
  });

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

  // Event handler slider opasitas layer
  document.querySelectorAll(".layer-list [data-opacity-key]").forEach((rng) => {
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

  // Basemap switcher, sinkron antara panel dan toolbar peta
  const basemapSelects = [
    document.getElementById("basemap-select"),
    document.getElementById("basemap-select-map"),
  ].filter(Boolean);

  function terapkanBasemap(key) {
    Object.values(basemaps).forEach((b) => {
      if (map.hasLayer(b)) map.removeLayer(b);
    });
    if (basemaps[key]) basemaps[key].addTo(map).bringToBack();
    basemapSelects.forEach((sel) => {
      if (sel.value !== key) sel.value = key;
    });
  }

  basemapSelects.forEach((sel) => {
    sel.addEventListener("change", (e) => terapkanBasemap(e.target.value));
  });

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

  window.LahanAmanSPKBridge = {
    getContext() {
      if (!state.activeKavlingResult || !state.activeKavlingGeometry) return null;
      const summary = state.activeKavlingResult.summary || {};
      let polygonAreaM2 = Number(summary.luas_poligon_m2);
      if (!Number.isFinite(polygonAreaM2) || polygonAreaM2 <= 0) {
        try {
          polygonAreaM2 = typeof turf !== "undefined" ? turf.area(state.activeKavlingGeometry) : null;
        } catch (_err) {
          polygonAreaM2 = null;
        }
      }
      return {
        geometry: state.activeKavlingGeometry,
        segments: state.activeKavlingResult.features || [],
        summary: summary,
        polygonAreaM2: polygonAreaM2,
        landUse: state.activeKavlingResult.land_use || null,
        sensitiveAreas: state.activeKavlingResult.sensitive_areas || null,
        crs: "EPSG:4326",
      };
    },
    startDrawing() {
      aktifkanModeGambarKavling();
    },
    loadSample() {
      prosesAnalisisKavling(DEMO_POLYGON_WGS84);
    },
    applyAssessment(assessment) {
      applySpkAssessment(assessment);
    },
    clearAssessment() {
      resetSpkMapState();
    },
    focusSegment(segId) {
      const layer = state.segmentLayersById[segId];
      if (!layer) return;
      if (layer.getBounds) {
        map.flyToBounds(layer.getBounds().pad(0.35), { duration: 0.6, maxZoom: 17.5 });
      }
      if (layer.openTooltip) layer.openTooltip();
    },
  };

  if (window.LahanAmanSPKUI) {
    window.LahanAmanSPKUI.init();
  }

  muatLayerUtama();
})();
