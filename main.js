(function () {
  "use strict";

  const COMMUNITY = {
    name: "Kevnai Community",
    shortName: "KevnaiHub",
    tagline: "Portal Nonton & Baca Komunitas Tanpa Iklan",
    welcomeTitle: "Selamat Datang di Ruang Hiburan Kevnai",
    welcomeDesc:
      "Pilih ruang hiburan di bawah ini. Semua tayangan Anime, Donghua, Film, Drama Korea, hingga cerita Wattpad telah dipisahkan sesuai kategorinya agar nyaman dijelajahi."
  };

  const DIRECT_BASE = "https://api.iroha-api.web.id";
  const FALLBACK_KEY = "iroha_267d3ed4b6d2afa34b83e7aa6747ee35bd29c9d7eea10cd6";

  let activeHub = "lobby";
  let activeSubTab = "home";
  let activePage = 1;
  let loklokNavId = "1000004";
  let loklokNavList = [];
  let activeGenreId = "";
  let activeGenreName = "";
  let currentSeries = null;
  let currentEpisodes = [];
  let activeEpRange = 0;
  let activeServers = [];
  let hlsInstance = null;
  let lightsOff = false;

  // Pastikan elemen #app selalu ada walaupun index.html minimalis
  function getAppContainer() {
    let el = document.getElementById("app");
    if (!el) {
      el = document.createElement("div");
      el.id = "app";
      document.body.appendChild(el);
    }
    return el;
  }

  function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatNumber(n) {
    const num = Number(n);
    if (!num || isNaN(num)) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1) + " Jt";
    if (num >= 1000) return (num / 1000).toFixed(1) + " Rb";
    return String(num);
  }

  function cleanTitle(raw) {
    if (!raw) return "Tanpa Judul";
    return String(raw)
      .replace(/\s*(?:episode|eps|ep)\s*\d+.*$/i, "")
      .replace(/\s*subtitle\s*indonesia.*$/i, "")
      .replace(/\s*sub\s*indo.*$/i, "")
      .replace(/\s*\(good\s*sub\).*$/i, "")
      .replace(/\s*\(\d+k\)\+?.*$/i, "")
      .replace(/\s*\(download\s*link\).*$/i, "")
      .trim();
  }

  function cleanBadge(rawBadge, rawTitle) {
    const combined = (rawBadge || "") + " " + (rawTitle || "");
    const epMatch = combined.match(/(?:episode|eps|ep)\s*(\d+(?:\.\d+)?)/i);
    if (epMatch) return "Ep " + epMatch[1];
    if (!rawBadge) return "Sub Indo";
    const s = String(rawBadge)
      .replace(/\(good\s*sub\)/gi, "")
      .replace(/\(\d+k\)\+?/gi, "")
      .replace(/\(download\s*link\)/gi, "")
      .replace(/subtitle\s*indonesia/gi, "")
      .trim();
    if (/^\d+$/.test(s)) return "Ep " + s;
    return s.slice(0, 14) || "Tersedia";
  }

  function cleanEpNumber(rawEpTitle, fallbackNum) {
    if (!rawEpTitle) return "Ep " + fallbackNum;
    const str = String(rawEpTitle).trim();
    if (/^\d+(\.\d+)?$/.test(str)) return "Ep " + str;
    const m =
      str.match(/(?:episode|eps|ep)\s*(\d+(?:\.\d+)?)/i) ||
      str.match(/-\s*(\d+(?:\.\d+)?)\s*(?:subtitle|sub|end|$)/i) ||
      str.match(/(\d+(?:\.\d+)?)\s*$/);
    return m ? "Ep " + m[1] : "Ep " + fallbackNum;
  }

  function resolvePoster(item) {
    let raw =
      item?.poster ||
      item?.coverVerticalUrl ||
      item?.coverHorizontalUrl ||
      item?.cover ||
      item?.thumbnail ||
      item?.thumb ||
      item?.image ||
      item?.img ||
      "";

    if (raw && typeof raw === "object") {
      raw = raw.url || raw.src || raw.large || "";
    }
    if (!raw || typeof raw !== "string") return "";
    raw = raw.trim();
    if (raw.startsWith("//")) raw = "https:" + raw;

    if (raw.includes("?u=") || raw.includes("&u=")) {
      try {
        const u = new URL(raw, DIRECT_BASE).searchParams.get("u");
        if (u) raw = decodeURIComponent(u);
      } catch (e) {}
    } else if (raw.startsWith("/")) {
      return DIRECT_BASE + raw + (raw.includes("?") ? "&" : "?") + "apikey=" + FALLBACK_KEY;
    }

    if (raw.startsWith("http")) {
      return "https://wsrv.nl/?url=" + encodeURIComponent(raw) + "&w=420&output=webp";
    }
    return "";
  }

  const coverCache = {};
  async function fetchMissingCover(imgEl) {
    if (!imgEl || imgEl.dataset.tried === "1") return;
    imgEl.dataset.tried = "1";
    const title = cleanTitle(imgEl.getAttribute("data-title") || "");
    if (!title) return;

    const key = "kh_cov_" + title.toLowerCase();
    const saved = coverCache[key] || localStorage.getItem(key);
    if (saved) {
      imgEl.src = saved;
      return;
    }

    try {
      const q = "query ($s: String) { Media(search: $s, type: ANIME) { coverImage { large } } }";
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, variables: { s: title } })
      });
      const json = await res.json();
      const url = json?.data?.Media?.coverImage?.large;
      if (url) {
        coverCache[key] = url;
        try { localStorage.setItem(key, url); } catch (e) {}
        imgEl.src = url;
      }
    } catch (e) {}
  }

  function hydratePosters() {
    document.querySelectorAll("img.lazy-poster").forEach(function (img) {
      if (!img.getAttribute("src")) fetchMissingCover(img);
    });
  }

  async function irohaFetch(path) {
    try {
      const res = await fetch("/api/iroha?path=" + encodeURIComponent(path));
      const cType = res.headers.get("content-type") || "";
      if (res.ok && cType.includes("json")) {
        return await res.json();
      }
    } catch (e) {}

    const sep = path.includes("?") ? "&" : "?";
    const direct = DIRECT_BASE + path + sep + "apikey=" + FALLBACK_KEY;
    const response = await fetch(direct, { headers: { "X-API-Key": FALLBACK_KEY } });
    if (!response.ok) throw new Error("Server status " + response.status);
    return await response.json();
  }

  function getSavedList() {
    try { return JSON.parse(localStorage.getItem("kh_saved_list") || "[]"); } catch (e) { return []; }
  }

  function isItemSaved(id) {
    return getSavedList().some(function (x) { return String(x.id) === String(id); });
  }

  function toggleSaveCurrent() {
    if (!currentSeries) return;
    let list = getSavedList();
    const exists = isItemSaved(currentSeries.id);
    if (exists) {
      list = list.filter(function (x) { return String(x.id) !== String(currentSeries.id); });
      notify("Dihapus dari daftar simpanan");
    } else {
      list.unshift({
        id: currentSeries.id,
        hub: currentSeries.hub,
        title: currentSeries.title,
        poster: currentSeries.poster,
        category: currentSeries.category || 1,
        badge: currentSeries.hub.toUpperCase()
      });
      notify("Ditambahkan ke daftar simpanan");
    }
    localStorage.setItem("kh_saved_list", JSON.stringify(list.slice(0, 50)));
    const btn = document.getElementById("saveSeriesBtn");
    if (btn) {
      const nowSaved = !exists;
      btn.innerHTML = '<i class="fa-' + (nowSaved ? "solid" : "regular") + ' fa-bookmark"></i> ' + (nowSaved ? "Tersimpan" : "Simpan");
    }
  }

  function markEpWatched(epKey) {
    try {
      const list = JSON.parse(localStorage.getItem("kh_watched_eps") || "[]");
      if (!list.includes(epKey)) {
        list.push(epKey);
        localStorage.setItem("kh_watched_eps", JSON.stringify(list.slice(-300)));
      }
    } catch (e) {}
  }

  function isEpWatched(epKey) {
    try {
      const list = JSON.parse(localStorage.getItem("kh_watched_eps") || "[]");
      return list.includes(epKey);
    } catch (e) { return false; }
  }

  function recordWatchHistory(entry) {
    try {
      let list = JSON.parse(localStorage.getItem("kh_watch_history") || "[]");
      list = list.filter(function (x) { return String(x.seriesId) !== String(entry.seriesId); });
      list.unshift({
        hub: entry.hub,
        seriesId: entry.seriesId,
        title: entry.title,
        epLabel: entry.epLabel,
        category: entry.category,
        time: new Date().toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      });
      localStorage.setItem("kh_watch_history", JSON.stringify(list.slice(0, 30)));
    } catch (e) {}
  }

  function getWatchHistory() {
    try { return JSON.parse(localStorage.getItem("kh_watch_history") || "[]"); } catch (e) { return []; }
  }

  function injectStyles() {
    document.head.insertAdjacentHTML(
      "beforeend",
      `<link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
      <style>
        :root {
          --bg-main: #0b0d14;
          --bg-surface: #131722;
          --bg-elevated: #1c2230;
          --bg-hover: #252d3f;
          --accent: #38bdf8;
          --accent-soft: rgba(56, 189, 248, 0.14);
          --text-primary: #f1f5f9;
          --text-secondary: #94a3b8;
          --border-subtle: rgba(255, 255, 255, 0.08);
          --radius-md: 12px;
          --radius-lg: 16px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background-color: var(--bg-main);
          color: var(--text-primary);
          min-height: 100vh;
          line-height: 1.5;
          padding-bottom: 76px;
        }
        a { color: inherit; text-decoration: none; }
        button, input { font-family: inherit; }

        .top-navbar {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(11, 13, 20, 0.9);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid var(--border-subtle);
        }
        .nav-container {
          max-width: 1180px;
          margin: 0 auto;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }
        .brand-logo {
          font-size: 19px;
          font-weight: 800;
          letter-spacing: -0.3px;
          display: flex;
          align-items: center;
          gap: 9px;
          cursor: pointer;
          color: #fff;
        }
        .brand-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--accent);
          display: inline-block;
        }
        .nav-links {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .nav-links::-webkit-scrollbar { display: none; }
        .nav-item {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 13.5px;
          font-weight: 600;
          padding: 8px 12px;
          border-radius: 8px;
          cursor: pointer;
          white-space: nowrap;
          transition: color 0.15s, background 0.15s;
        }
        .nav-item:hover { color: #fff; background: rgba(255,255,255,0.05); }
        .nav-item.active { color: var(--accent); background: var(--accent-soft); }

        .search-form {
          display: flex;
          align-items: center;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 4px 4px 4px 12px;
          flex: 1;
          max-width: 320px;
          min-width: 200px;
        }
        .search-form:focus-within { border-color: var(--accent); }
        .search-form input {
          background: transparent;
          border: none;
          color: #fff;
          font-size: 13px;
          width: 100%;
          outline: none;
        }
        .search-form button {
          background: var(--bg-elevated);
          border: none;
          color: var(--text-primary);
          padding: 7px 12px;
          border-radius: 7px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .search-form button:hover { background: var(--accent); color: #000; }

        .main-wrap {
          max-width: 1180px;
          margin: 0 auto;
          padding: 20px 16px 40px;
        }

        .breadcrumb {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
          color: var(--text-secondary);
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .breadcrumb span.clickable { cursor: pointer; color: var(--accent); }
        .breadcrumb span.clickable:hover { text-decoration: underline; }

        .lobby-banner {
          background: linear-gradient(135deg, #161f33 0%, #0f1420 100%);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 28px 24px;
          margin-bottom: 24px;
        }
        .lobby-badge {
          display: inline-block;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--accent);
          background: var(--accent-soft);
          padding: 4px 10px;
          border-radius: 6px;
          margin-bottom: 10px;
        }
        .lobby-banner h1 {
          font-size: clamp(22px, 4vw, 30px);
          font-weight: 800;
          margin-bottom: 8px;
          letter-spacing: -0.4px;
        }
        .lobby-banner p {
          color: var(--text-secondary);
          font-size: 14px;
          max-width: 680px;
        }

        .hub-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }
        .hub-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 20px;
          cursor: pointer;
          transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 14px;
        }
        .hub-card:hover {
          transform: translateY(-3px);
          border-color: var(--accent);
          background: #171c2b;
        }
        .hub-icon {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          background: var(--accent-soft);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }
        .hub-card h3 { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
        .hub-card p { font-size: 13px; color: var(--text-secondary); line-height: 1.45; }
        .hub-enter {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--accent);
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .filter-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 8px;
          margin-bottom: 18px;
          scrollbar-width: none;
        }
        .filter-bar::-webkit-scrollbar { display: none; }
        .chip {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          padding: 8px 14px;
          border-radius: 99px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: 0.15s;
        }
        .chip:hover { color: #fff; border-color: rgba(255,255,255,0.2); }
        .chip.active {
          background: var(--accent);
          color: #090d16;
          border-color: var(--accent);
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
          gap: 10px;
        }
        .section-header h2 {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.2px;
        }
        .poster-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
          gap: 16px;
        }
        @media (max-width: 480px) {
          .poster-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
        }
        .media-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          overflow: hidden;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          transition: transform 0.18s ease, border-color 0.18s ease;
        }
        .media-card:hover {
          transform: translateY(-3px);
          border-color: rgba(255, 255, 255, 0.24);
        }
        .poster-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 2 / 2.9;
          background: #161b28;
          overflow: hidden;
        }
        .poster-wrap img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: transform 0.25s ease;
        }
        .media-card:hover .poster-wrap img { transform: scale(1.03); }
        .badge-overlay {
          position: absolute;
          top: 8px;
          left: 8px;
          background: rgba(11, 13, 20, 0.85);
          backdrop-filter: blur(6px);
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.12);
        }
        .media-info {
          padding: 10px 12px;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .media-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.4;
        }

        .skeleton-card {
          background: var(--bg-surface);
          border-radius: var(--radius-md);
          overflow: hidden;
          border: 1px solid var(--border-subtle);
        }
        .sk-box {
          width: 100%;
          aspect-ratio: 2 / 2.9;
          background: linear-gradient(90deg, #161b28 25%, #202738 50%, #161b28 75%);
          background-size: 200% 100%;
          animation: shimmer 1.4s infinite;
        }
        .sk-line {
          height: 14px;
          margin: 12px;
          border-radius: 4px;
          background: #1e2536;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        .wattpad-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }
        .wp-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 14px;
          display: flex;
          gap: 14px;
          align-items: flex-start;
        }
        .wp-cover {
          width: 80px;
          aspect-ratio: 2 / 3;
          border-radius: 8px;
          object-fit: cover;
          background: #1a2030;
          flex-shrink: 0;
        }
        .wp-meta { flex: 1; min-width: 0; }
        .wp-meta h4 {
          font-size: 14.5px;
          font-weight: 700;
          margin-bottom: 4px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .wp-author { font-size: 12px; color: var(--accent); margin-bottom: 6px; }
        .wp-stats {
          display: flex;
          gap: 10px;
          font-size: 11.5px;
          color: var(--text-secondary);
          margin-bottom: 10px;
          flex-wrap: wrap;
        }

        .surface-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 20px;
          margin-bottom: 20px;
        }
        .detail-grid {
          display: grid;
          grid-template-columns: 180px 1fr;
          gap: 22px;
        }
        @media (max-width: 600px) {
          .detail-grid { grid-template-columns: 1fr; text-align: center; }
          .detail-cover { max-width: 165px; margin: 0 auto; }
        }
        .detail-cover {
          width: 100%;
          aspect-ratio: 2 / 2.9;
          border-radius: var(--radius-md);
          overflow: hidden;
          background: #161b28;
          border: 1px solid var(--border-subtle);
        }
        .detail-cover img { width: 100%; height: 100%; object-fit: cover; }
        .detail-content h1 { font-size: clamp(20px, 4vw, 26px); font-weight: 800; margin-bottom: 8px; }
        .detail-synopsis { font-size: 13.5px; color: var(--text-secondary); line-height: 1.65; margin-bottom: 16px; }

        .btn {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          padding: 9px 15px;
          border-radius: 9px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          transition: 0.15s;
        }
        .btn:hover { background: var(--bg-hover); }
        .btn.primary { background: var(--accent); color: #090d16; border-color: var(--accent); }
        .btn.primary:hover { filter: brightness(1.08); }

        .ep-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(95px, 1fr));
          gap: 8px;
          max-height: 440px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .ep-item {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          padding: 10px 8px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          text-align: center;
          transition: 0.15s;
        }
        .ep-item:hover { border-color: var(--accent); color: var(--accent); }
        .ep-item.watched {
          opacity: 0.6;
          border-color: rgba(52, 211, 153, 0.35);
          color: #34d399;
        }

        .cinema-dim {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.88);
          z-index: 200;
          display: none;
        }
        .cinema-dim.active { display: block; }
        .player-wrapper { position: relative; z-index: 201; }
        .video-box {
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #000;
          border-radius: var(--radius-md);
          overflow: hidden;
          margin: 12px 0;
          border: 1px solid var(--border-subtle);
        }
        .video-box video, .video-box iframe { width: 100%; height: 100%; border: none; display: block; }

        .pagination {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          margin-top: 26px;
        }

        .bottom-nav {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 120;
          background: rgba(13, 16, 25, 0.95);
          backdrop-filter: blur(12px);
          border-top: 1px solid var(--border-subtle);
          display: none;
          grid-template-columns: repeat(4, 1fr);
          padding: 6px 8px;
        }
        @media (max-width: 720px) {
          .bottom-nav { display: grid; }
        }
        .bnav-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          font-size: 11px;
          font-weight: 600;
          padding: 6px;
          cursor: pointer;
        }
        .bnav-btn i { font-size: 16px; }
        .bnav-btn.active { color: var(--accent); }

        .toast-notice {
          position: fixed;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-elevated);
          border: 1px solid var(--accent);
          color: #fff;
          padding: 10px 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          z-index: 9999;
          box-shadow: 0 10px 25px rgba(0,0,0,0.6);
        }

        .site-footer {
          margin-top: 48px;
          padding-top: 20px;
          border-top: 1px solid var(--border-subtle);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          font-size: 12.5px;
          color: var(--text-secondary);
        }
      </style>`
    );
  }

  function notify(msg) {
    const old = document.getElementById("khToast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.id = "khToast";
    t.className = "toast-notice";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }

  function renderLayout() {
    const app = getAppContainer();
    app.innerHTML = `
      <div class="cinema-dim" id="cinemaDim" onclick="toggleCinemaLights()"></div>

      <header class="top-navbar">
        <div class="nav-container">
          <div class="brand-logo" onclick="openHub('lobby')">
            <span class="brand-dot"></span> ${escapeHTML(COMMUNITY.shortName)}
          </div>

          <nav class="nav-links" id="topNavLinks">
            <button class="nav-item active" data-hub="lobby" onclick="openHub('lobby')">Lobby</button>
            <button class="nav-item" data-hub="anime" onclick="openHub('anime')">Anime</button>
            <button class="nav-item" data-hub="donghua" onclick="openHub('donghua')">Donghua</button>
            <button class="nav-item" data-hub="loklok" onclick="openHub('loklok')">Film &amp; Drama</button>
            <button class="nav-item" data-hub="wattpad" onclick="openHub('wattpad')">Wattpad</button>
            <button class="nav-item" data-hub="saved" onclick="openHub('saved')">Tersimpan</button>
            <button class="nav-item" data-hub="history" onclick="openHub('history')">Riwayat</button>
          </nav>

          <form class="search-form" onsubmit="submitSearch(event)">
            <input type="text" id="globalSearchInput" placeholder="Cari judul di ruang ini... (Tekan /)" autocomplete="off">
            <button type="submit"><i class="fa-solid fa-magnifying-glass"></i></button>
          </form>
        </div>
      </header>

      <div class="main-wrap">
        <div id="breadcrumbBar" class="breadcrumb"></div>
        <div id="filterContainer"></div>
        <main id="viewContainer"></main>

        <footer class="site-footer">
          <span><strong>${escapeHTML(COMMUNITY.name)}</strong> &mdash; ${escapeHTML(COMMUNITY.tagline)}</span>
          <span>Bebas Iklan Pop-up &bull; Multi-Server Streaming</span>
        </footer>
      </div>

      <nav class="bottom-nav">
        <button class="bnav-btn active" data-bnav="lobby" onclick="openHub('lobby')">
          <i class="fa-solid fa-compass"></i><span>Lobby</span>
        </button>
        <button class="bnav-btn" data-bnav="anime" onclick="openHub('anime')">
          <i class="fa-solid fa-tv"></i><span>Anime</span>
        </button>
        <button class="bnav-btn" data-bnav="loklok" onclick="openHub('loklok')">
          <i class="fa-solid fa-clapperboard"></i><span>Film &amp; Drama</span>
        </button>
        <button class="bnav-btn" data-bnav="saved" onclick="openHub('saved')">
          <i class="fa-regular fa-bookmark"></i><span>Tersimpan</span>
        </button>
      </nav>
    `;

    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        const inp = document.getElementById("globalSearchInput");
        if (inp) inp.focus();
      }
    });
  }

  function updateNavHighlight() {
    document.querySelectorAll("#topNavLinks .nav-item").forEach(function (b) {
      b.classList.toggle("active", b.dataset.hub === activeHub);
    });
    document.querySelectorAll(".bottom-nav .bnav-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.bnav === activeHub);
    });
  }

  function setBreadcrumb(items) {
    const bar = document.getElementById("breadcrumbBar");
    if (!bar) return;
    if (!items || items.length === 0) {
      bar.innerHTML = "";
      return;
    }
    bar.innerHTML = items
      .map(function (it, idx) {
        if (idx === items.length - 1) return "<span>" + escapeHTML(it.label) + "</span>";
        return '<span class="clickable" onclick="' + it.action + '">' + escapeHTML(it.label) + '</span> <i class="fa-solid fa-chevron-right" style="font-size:10px;"></i>';
      })
      .join(" ");
  }

  function renderSkeletons(count) {
    const total = count || 10;
    let html = '<div class="poster-grid">';
    for (let i = 0; i < total; i++) {
      html += '<div class="skeleton-card"><div class="sk-box"></div><div class="sk-line"></div></div>';
    }
    html += "</div>";
    const view = document.getElementById("viewContainer");
    if (view) view.innerHTML = html;
  }

  function openHub(hubName) {
    destroyHls();
    if (lightsOff) toggleCinemaLights();
    activeHub = hubName;
    activePage = hubName === "loklok" ? 0 : 1;
    activeSubTab = "home";
    updateNavHighlight();

    const searchInput = document.getElementById("globalSearchInput");
    const placeholders = {
      lobby: "Cari anime, donghua, film, atau cerita...",
      anime: "Cari judul Anime (contoh: One Piece, Naruto)...",
      donghua: "Cari judul Donghua (contoh: Soul Land, BTTH)...",
      loklok: "Cari Film / Drama Korea (contoh: Marvel, Drama)...",
      wattpad: "Cari cerita Wattpad (contoh: romantis, kampus)..."
    };
    if (searchInput && placeholders[hubName]) {
      searchInput.placeholder = placeholders[hubName];
    }

    if (hubName === "lobby") {
      renderLobbyView();
    } else if (hubName === "saved") {
      renderSavedView();
    } else if (hubName === "history") {
      renderHistoryView();
    } else {
      loadHubCatalog(activeSubTab, activePage);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderLobbyView() {
    setBreadcrumb([]);
    const fc = document.getElementById("filterContainer");
    if (fc) fc.innerHTML = "";
    const history = getWatchHistory();
    const lastWatchedHTML =
      history.length > 0
        ? `
      <div class="surface-card" style="margin-bottom:24px;">
        <div class="section-header" style="margin-bottom:10px;">
          <h2 style="font-size:16px;"><i class="fa-solid fa-clock-rotate-left" style="color:var(--accent); margin-right:6px;"></i> Lanjutkan Menonton</h2>
          <button class="btn" style="padding:5px 10px; font-size:12px;" onclick="openHub('history')">Lihat Semua</button>
        </div>
        <div style="display:flex; gap:12px; overflow-x:auto; padding-bottom:6px;">
          ${history
            .slice(0, 5)
            .map(function (h) {
              return `
            <div class="btn" style="flex:0 0 240px; justify-content:space-between; text-align:left;" onclick="resumeHistoryItem('${escapeHTML(h.hub)}', '${escapeHTML(h.seriesId)}', '${escapeHTML(h.category || 1)}')">
              <div style="overflow:hidden;">
                <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(h.title)}</div>
                <div style="font-size:11.5px; color:var(--accent);">${escapeHTML(h.epLabel)} &bull; ${escapeHTML(h.hub.toUpperCase())}</div>
              </div>
              <i class="fa-solid fa-play"></i>
            </div>
          `;
            })
            .join("")}
        </div>
      </div>
    `
        : "";

    document.getElementById("viewContainer").innerHTML = `
      <section class="lobby-banner">
        <span class="lobby-badge">${escapeHTML(COMMUNITY.name)}</span>
        <h1>${escapeHTML(COMMUNITY.welcomeTitle)}</h1>
        <p>${escapeHTML(COMMUNITY.welcomeDesc)}</p>
      </section>

      ${lastWatchedHTML}

      <div class="section-header">
        <h2>Pilih Ruang Hiburan</h2>
      </div>

      <div class="hub-grid">
        <div class="hub-card" onclick="openHub('anime')">
          <div>
            <div class="hub-icon"><i class="fa-solid fa-tv"></i></div>
            <h3 style="margin-top:12px;">Anime Sub Indo</h3>
            <p>Katalog anime Jepang sedang tayang (ongoing), tamat, daftar genre lengkap, dan jadwal rilis harian.</p>
          </div>
          <span class="hub-enter">Masuk ke Ruang Anime <i class="fa-solid fa-arrow-right"></i></span>
        </div>

        <div class="hub-card" onclick="openHub('donghua')">
          <div>
            <div class="hub-icon"><i class="fa-solid fa-dragon"></i></div>
            <h3 style="margin-top:12px;">Donghua Series</h3>
            <p>Koleksi animasi kultivasi &amp; fantasi Tiongkok subtitle Indonesia lengkap dengan pilihan mirror server.</p>
          </div>
          <span class="hub-enter">Masuk ke Ruang Donghua <i class="fa-solid fa-arrow-right"></i></span>
        </div>

        <div class="hub-card" onclick="openHub('loklok')">
          <div>
            <div class="hub-icon"><i class="fa-solid fa-clapperboard"></i></div>
            <h3 style="margin-top:12px;">Film &amp; Drama (Loklok)</h3>
            <p>Tonton film bioskop, drama Korea, drama China, dan serial populer dengan kualitas streaming HD.</p>
          </div>
          <span class="hub-enter">Masuk ke Film &amp; Drama <i class="fa-solid fa-arrow-right"></i></span>
        </div>

        <div class="hub-card" onclick="openHub('wattpad')">
          <div>
            <div class="hub-icon"><i class="fa-solid fa-book-open"></i></div>
            <h3 style="margin-top:12px;">Cerita Wattpad</h3>
            <p>Jelajahi novel dan cerita populer Wattpad lengkap dengan statistik pembaca, vote, dan pencarian topik.</p>
          </div>
          <span class="hub-enter">Masuk ke Ruang Wattpad <i class="fa-solid fa-arrow-right"></i></span>
        </div>
      </div>
    `;
  }

  function resumeHistoryItem(hub, seriesId, category) {
    activeHub = hub;
    updateNavHighlight();
    openSeriesDetail(seriesId, Number(category) || 1);
  }

  async function renderHubFilters() {
    const box = document.getElementById("filterContainer");
    if (!box) return;

    if (activeHub === "anime") {
      const tabs = [
        { id: "home", label: "Terbaru" },
        { id: "ongoing", label: "Sedang Tayang" },
        { id: "complete", label: "Selesai Tayang" },
        { id: "genres", label: "Daftar Genre" },
        { id: "jadwal", label: "Jadwal Rilis" }
      ];
      box.innerHTML =
        '<div class="filter-bar">' +
        tabs
          .map(function (t) {
            return '<button class="chip ' + (activeSubTab === t.id ? "active" : "") + '" onclick="loadHubCatalog(\'' + t.id + '\', 1)">' + t.label + "</button>";
          })
          .join("") +
        "</div>";
    } else if (activeHub === "donghua") {
      const tabs = [
        { id: "home", label: "Episode Terbaru" },
        { id: "new-series", label: "Serial Baru" },
        { id: "completed", label: "Sudah Tamat" },
        { id: "schedule", label: "Jadwal Tayang" }
      ];
      box.innerHTML =
        '<div class="filter-bar">' +
        tabs
          .map(function (t) {
            return '<button class="chip ' + (activeSubTab === t.id ? "active" : "") + '" onclick="loadHubCatalog(\'' + t.id + '\', 1)">' + t.label + "</button>";
          })
          .join("") +
        "</div>";
    } else if (activeHub === "loklok") {
      if (loklokNavList.length === 0) {
        try {
          const navJson = await irohaFetch("/v1/loklok?action=nav");
          const rawNav = navJson?.data || navJson?.result || [];
          if (Array.isArray(rawNav) && rawNav.length > 0) {
            loklokNavList = rawNav.map(function (n) {
              return {
                id: String(n.navigationId || n.id || "1000004"),
                name: n.name || n.title || "Kategori"
              };
            });
          }
        } catch (e) {}
      }
      if (loklokNavList.length === 0) {
        loklokNavList = [{ id: "1000004", name: "Pilihan Utama" }];
      }
      box.innerHTML =
        '<div class="filter-bar">' +
        loklokNavList
          .map(function (n) {
            return '<button class="chip ' + (loklokNavId === n.id ? "active" : "") + '" onclick="selectLoklokNav(\'' + escapeHTML(n.id) + '\')">' + escapeHTML(n.name) + "</button>";
          })
          .join("") +
        "</div>";
    } else if (activeHub === "wattpad") {
      const topics = [
        { id: "home", label: "Populer Saat Ini" },
        { id: "romantis", label: "Romantis" },
        { id: "fantasi", label: "Fantasi" },
        { id: "horor", label: "Horor & Misteri" },
        { id: "fiksiremaja", label: "Fiksi Remaja" },
        { id: "komedi", label: "Komedi" }
      ];
      box.innerHTML =
        '<div class="filter-bar">' +
        topics
          .map(function (t) {
            return '<button class="chip ' + (activeSubTab === t.id ? "active" : "") + '" onclick="loadWattpadTopic(\'' + t.id + '\')">' + t.label + "</button>";
          })
          .join("") +
        "</div>";
    } else {
      box.innerHTML = "";
    }
  }

  function selectLoklokNav(navId) {
    loklokNavId = navId;
    loadHubCatalog("home", 0);
  }

  function loadWattpadTopic(topic) {
    activeSubTab = topic;
    loadHubCatalog(topic, 1);
  }

  function extractMediaArray(json) {
    const d = json?.data || json?.result || json || {};
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.animeList)) return d.animeList;
    if (Array.isArray(d.ongoing?.animeList)) return d.ongoing.animeList;
    if (Array.isArray(d.completed?.animeList)) return d.completed.animeList;
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.results)) return d.results;
    if (Array.isArray(d.items)) return d.items;
    if (Array.isArray(d.searchResults)) return d.searchResults;

    if (Array.isArray(d.recommendItems)) {
      const flattened = [];
      d.recommendItems.forEach(function (sec) {
        const sub = sec.recommendContentVOList || sec.items || sec.list || [];
        if (Array.isArray(sub)) flattened.push.apply(flattened, sub);
      });
      if (flattened.length > 0) return flattened;
    }

    const keys = Object.keys(d);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (Array.isArray(d[k]) && d[k].length > 0 && typeof d[k][0] === "object") return d[k];
    }
    return [];
  }

  async function loadHubCatalog(subTab, page) {
    destroyHls();
    activeSubTab = subTab || "home";
    activePage = page !== undefined ? page : 1;

    const hubLabels = {
      anime: "Ruang Anime",
      donghua: "Ruang Donghua",
      loklok: "Film & Drama (Loklok)",
      wattpad: "Cerita Wattpad"
    };
    setBreadcrumb([
      { label: "Lobby", action: "openHub('lobby')" },
      { label: hubLabels[activeHub] || "Katalog", action: "" }
    ]);

    await renderHubFilters();
    renderSkeletons(10);

    try {
      if (activeHub === "wattpad") {
        const wpPath =
          activeSubTab === "home"
            ? "/v1/wattpad?action=home&limit=24"
            : "/v1/wattpad?action=search&q=" + encodeURIComponent(activeSubTab) + "&limit=24";
        const wpJson = await irohaFetch(wpPath);
        return renderWattpadCatalog(wpJson);
      }

      if (activeHub === "loklok") {
        const lkPage = Math.max(0, Number(activePage) || 0);
        activePage = lkPage;
        const lkJson = await irohaFetch(
          "/v1/loklok?action=home&navigationId=" + encodeURIComponent(loklokNavId) + "&page=" + lkPage
        );
        const lkList = extractMediaArray(lkJson);
        return renderPosterCatalog(lkList, "Katalog Film & Drama", true, true);
      }

      if (activeHub === "anime") {
        if (activeSubTab === "genres") {
          const gJson = await irohaFetch("/v1/anime/streaming/genres");
          return renderAnimeGenres(gJson);
        }
        if (activeSubTab === "jadwal") {
          const sJson = await irohaFetch("/v1/anime/streaming/jadwal");
          return renderScheduleView(sJson);
        }
        let path = "/v1/anime/streaming/home";
        if (activeSubTab === "home" && activePage > 1) path = "/v1/anime/streaming/ongoing?page=" + activePage;
        else if (activeSubTab === "ongoing") path = "/v1/anime/streaming/ongoing?page=" + activePage;
        else if (activeSubTab === "complete") path = "/v1/anime/streaming/complete?page=" + activePage;
        else if (activeSubTab === "genre-detail") path = "/v1/anime/streaming/genre/" + encodeURIComponent(activeGenreId) + "?page=" + activePage;

        const aJson = await irohaFetch(path);
        const aList = extractMediaArray(aJson);
        const title = activeSubTab === "genre-detail" ? "Genre: " + activeGenreName : "Daftar Anime";
        return renderPosterCatalog(aList, title, true, false);
      }

      if (activeHub === "donghua") {
        if (activeSubTab === "schedule") {
          const dSched = await irohaFetch("/v1/donghub?action=schedule");
          return renderScheduleView(dSched);
        }
        const dJson = await irohaFetch("/v1/donghub?action=" + encodeURIComponent(activeSubTab) + "&page=" + activePage);
        const dList = extractMediaArray(dJson);
        return renderPosterCatalog(dList, "Daftar Donghua", true, false);
      }
    } catch (err) {
      document.getElementById("viewContainer").innerHTML = `
        <div class="surface-card" style="text-align:center; padding:36px 20px;">
          <p style="color:var(--text-secondary); margin-bottom:12px;">Koneksi ke sumber sedang padat atau halaman telah habis.</p>
          <button class="btn primary" onclick="loadHubCatalog('${activeSubTab}', ${activeHub === "loklok" ? 0 : 1})">Muat Ulang</button>
        </div>
      `;
    }
  }

  async function submitSearch(e) {
    e.preventDefault();
    const inp = document.getElementById("globalSearchInput");
    const q = inp ? inp.value.trim() : "";
    if (!q) return;

    if (activeHub === "lobby" || activeHub === "saved" || activeHub === "history") {
      activeHub = "anime";
      updateNavHighlight();
    }

    await renderHubFilters();
    renderSkeletons(8);

    try {
      if (activeHub === "wattpad") {
        const wpJson = await irohaFetch("/v1/wattpad?action=search&q=" + encodeURIComponent(q) + "&limit=25");
        return renderWattpadCatalog(wpJson, 'Hasil Pencarian Wattpad: "' + q + '"');
      }
      if (activeHub === "loklok") {
        const lkJson = await irohaFetch("/v1/loklok?action=search&query=" + encodeURIComponent(q) + "&size=24");
        const lkList = extractMediaArray(lkJson);
        return renderPosterCatalog(lkList, 'Hasil Pencarian Film/Drama: "' + q + '"', false, true);
      }
      if (activeHub === "donghua") {
        const dJson = await irohaFetch("/v1/donghub?action=search&q=" + encodeURIComponent(q));
        const dList = extractMediaArray(dJson);
        return renderPosterCatalog(dList, 'Hasil Pencarian Donghua: "' + q + '"', false, false);
      }
      const aJson = await irohaFetch("/v1/anime/streaming/search?q=" + encodeURIComponent(q));
      const aList = extractMediaArray(aJson);
      return renderPosterCatalog(aList, 'Hasil Pencarian Anime: "' + q + '"', false, false);
    } catch (err) {
      document.getElementById("viewContainer").innerHTML =
        '<div class="surface-card" style="text-align:center;">Tidak ditemukan hasil untuk "' + escapeHTML(q) + '".</div>';
    }
  }

  function renderPosterCatalog(list, sectionTitle, withPagination, isLoklok) {
    const view = document.getElementById("viewContainer");
    if (!Array.isArray(list) || list.length === 0) {
      view.innerHTML = '<div class="surface-card" style="text-align:center;">Belum ada tayangan di halaman ini.</div>';
      return;
    }

    const cards = list
      .map(function (item) {
        const id = item.animeId || item.slug || item.id || item.contentId || item.jumpAddress || "";
        const rawTitle = item.title || item.name || "Tayangan";
        const displayTitle = cleanTitle(rawTitle);
        const poster = resolvePoster(item);
        const category = item.category !== undefined ? item.category : item.domainType !== undefined ? item.domainType : 1;
        const badge = isLoklok
          ? Number(category) === 0
            ? "Film"
            : "Series"
          : cleanBadge(item.episodes || item.episode || item.latestEpisode || item.status, rawTitle);

        const isDirectDonghuaEp = activeHub === "donghua" && String(id).includes("episode");
        const onClick = isDirectDonghuaEp
          ? "openWatchPlayer('" + escapeHTML(id) + "', '" + escapeHTML(displayTitle) + "', '', 1)"
          : "openSeriesDetail('" + escapeHTML(id) + "', " + (Number(category) || 1) + ", '" + escapeHTML(displayTitle) + "', '" + escapeHTML(poster) + "')";

        return `
          <div class="media-card" onclick="${onClick}">
            <div class="poster-wrap">
              <span class="badge-overlay">${escapeHTML(badge)}</span>
              <img class="lazy-poster"
                   src="${escapeHTML(poster)}"
                   data-title="${escapeHTML(displayTitle)}"
                   alt=""
                   loading="lazy"
                   referrerpolicy="no-referrer"
                   onerror="window.onImgErr(this)">
            </div>
            <div class="media-info">
              <div class="media-title">${escapeHTML(displayTitle)}</div>
            </div>
          </div>
        `;
      })
      .join("");

    const minPage = isLoklok ? 0 : 1;
    const displayPageNum = isLoklok ? activePage + 1 : activePage;
    const pagHTML = withPagination
      ? `
      <div class="pagination">
        <button class="btn" ${activePage <= minPage ? "disabled style='opacity:0.4;pointer-events:none;'" : ""} onclick="loadHubCatalog('${activeSubTab}', ${activePage - 1})">
          <i class="fa-solid fa-chevron-left"></i> Sebelumnya
        </button>
        <span style="font-size:13px; font-weight:600; color:var(--text-secondary);">Halaman ${displayPageNum}</span>
        <button class="btn primary" onclick="loadHubCatalog('${activeSubTab}', ${activePage + 1})">
          Selanjutnya <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    `
      : "";

    view.innerHTML = `
      <div class="section-header">
        <h2>${escapeHTML(sectionTitle)}</h2>
      </div>
      <div class="poster-grid">${cards}</div>
      ${pagHTML}
    `;

    hydratePosters();
  }

  function onImgErr(img) {
    if (!img) return;
    img.onerror = null;
    fetchMissingCover(img);
  }

  function renderWattpadCatalog(json, titleHeading) {
    const heading = titleHeading || "Cerita Wattpad Populer";
    const d = json?.data || json?.result || json || {};
    const stories = Array.isArray(d) ? d : d.stories || d.list || d.results || [];
    const view = document.getElementById("viewContainer");

    if (!Array.isArray(stories) || stories.length === 0) {
      view.innerHTML = '<div class="surface-card" style="text-align:center;">Tidak ada cerita Wattpad yang ditemukan.</div>';
      return;
    }

    const cards = stories
      .map(function (st) {
        const title = st.title || "Cerita Wattpad";
        const author = typeof st.author === "object" ? st.author?.name || st.author?.username : st.author || st.user || "Penulis";
        const reads = formatNumber(st.reads || st.readCount || 0);
        const votes = formatNumber(st.votes || st.voteCount || 0);
        const status = st.status || (st.completed ? "Completed" : "Ongoing");
        const url = st.url || "https://www.wattpad.com";
        const cover = resolvePoster(st);

        return `
          <div class="wp-card">
            <img class="wp-cover" src="${escapeHTML(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">
            <div class="wp-meta">
              <h4>${escapeHTML(title)}</h4>
              <div class="wp-author">@${escapeHTML(author)}</div>
              <div class="wp-stats">
                <span><i class="fa-regular fa-eye"></i> ${reads}</span>
                <span><i class="fa-regular fa-star"></i> ${votes}</span>
                <span>&bull; ${escapeHTML(status)}</span>
              </div>
              <a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="btn primary" style="padding:6px 12px; font-size:12px;">
                Baca di Wattpad <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;"></i>
              </a>
            </div>
          </div>
        `;
      })
      .join("");

    view.innerHTML = `
      <div class="section-header"><h2>${escapeHTML(heading)}</h2></div>
      <div class="wattpad-grid">${cards}</div>
    `;
  }

  function renderAnimeGenres(json) {
    const d = json?.data || json || {};
    const list = Array.isArray(d) ? d : d.genreList || d.genres || [];
    const view = document.getElementById("viewContainer");
    view.innerHTML = `
      <div class="surface-card">
        <h3 style="margin-bottom:14px;">Pilih Genre Anime</h3>
        <div class="ep-grid">
          ${list
            .map(function (g) {
              const id = g.genreId || g.slug || g.id || "";
              const name = g.title || g.name || id;
              return '<button class="ep-item" onclick="selectAnimeGenre(\'' + escapeHTML(id) + "', '" + escapeHTML(name) + '\')">' + escapeHTML(name) + "</button>";
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function selectAnimeGenre(id, name) {
    activeGenreId = id;
    activeGenreName = name;
    loadHubCatalog("genre-detail", 1);
  }

  function renderScheduleView(json) {
    const d = json?.data || json || {};
    const days = Array.isArray(d) ? d : d.scheduleList || d.days || [];
    const view = document.getElementById("viewContainer");
    if (!Array.isArray(days) || days.length === 0) {
      const flat = extractMediaArray(json);
      if (flat.length > 0) return renderPosterCatalog(flat, "Jadwal Rilis", false, false);
      view.innerHTML = '<div class="surface-card">Jadwal belum tersedia.</div>';
      return;
    }
    view.innerHTML = days
      .map(function (day) {
        const list = day.animeList || day.list || day.items || [];
        return `
          <div class="surface-card">
            <h3 style="color:var(--accent); margin-bottom:12px;">${escapeHTML(day.day || day.title || "Hari")}</h3>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:8px;">
              ${list
                .map(function (x) {
                  return '<button class="ep-item" style="text-align:left;" onclick="openSeriesDetail(\'' + escapeHTML(x.animeId || x.slug || x.id) + '\', 1)">' + escapeHTML(x.title || x.name) + "</button>";
                })
                .join("")}
            </div>
          </div>
        `;
      })
      .join("");
  }

  async function openSeriesDetail(id, category, fallbackTitle, fallbackPoster) {
    if (!id) return;
    const cat = category !== undefined ? category : 1;
    const fbTitle = fallbackTitle || "";
    const fbPoster = fallbackPoster || "";

    destroyHls();
    setBreadcrumb([
      { label: "Lobby", action: "openHub('lobby')" },
      { label: activeHub.toUpperCase(), action: "openHub('" + activeHub + "')" },
      { label: "Detail Tayangan", action: "" }
    ]);

    document.getElementById("viewContainer").innerHTML = '<div class="surface-card" style="text-align:center; padding:40px;">Memuat rincian tayangan &amp; daftar episode...</div>';

    try {
      let title = fbTitle;
      let poster = fbPoster;
      let synopsis = "Pilih nomor episode di bawah untuk mulai menonton.";
      let eps = [];

      if (activeHub === "loklok") {
        const lkJson = await irohaFetch(
          "/v1/loklok?action=episodes&id=" + encodeURIComponent(id) + "&category=" + encodeURIComponent(cat)
        );
        const d = lkJson?.data || lkJson?.result || lkJson || {};
        title = d.name || d.title || fbTitle || "Film / Drama";
        poster = resolvePoster(d) || fbPoster;
        synopsis = d.introduction || d.synopsis || d.description || synopsis;
        const rawList = d.episodeVo || d.episodes || d.episodeList || (Array.isArray(d) ? d : []);

        if (Array.isArray(rawList) && rawList.length > 0) {
          eps = rawList.map(function (ep, i) {
            const vid = ep.id || ep.vid || ep.episodeId || "";
            const no = ep.seriesNo || ep.episode || i + 1;
            return {
              epId: String(vid),
              label: "Ep " + no,
              fullTitle: title + " - Episode " + no,
              contentId: id,
              category: cat
            };
          });
        } else if (d.id || id) {
          eps = [{ epId: String(d.vid || d.id || id), label: "Putar Film", fullTitle: title, contentId: id, category: cat }];
        }
      } else {
        const path =
          activeHub === "anime"
            ? "/v1/anime/streaming/anime/" + encodeURIComponent(id)
            : "/v1/donghub?action=detail&slug=" + encodeURIComponent(id);
        const json = await irohaFetch(path);
        const d = json?.data?.details || json?.data || json?.result || json || {};
        title = cleanTitle(d.title || d.name || fbTitle || id);
        poster = resolvePoster(d) || fbPoster;
        synopsis = Array.isArray(d.synopsis?.paragraphs)
          ? d.synopsis.paragraphs.join(" ")
          : d.synopsis || d.description || d.desc || synopsis;

        const rawList = d.episodeList || d.episodes || d.chapterList || [];
        eps = rawList.map(function (ep, idx) {
          const epId = ep.episodeId || ep.slug || ep.id || "";
          const rawEpName = ep.title || ep.name || String(ep.eps || rawList.length - idx);
          return {
            epId: epId,
            label: cleanEpNumber(rawEpName, rawList.length - idx),
            fullTitle: rawEpName,
            contentId: id,
            category: 1
          };
        });
      }

      currentSeries = { id: id, hub: activeHub, title: title, poster: poster, synopsis: synopsis, category: cat };
      currentEpisodes = eps;
      activeEpRange = 0;

      renderSeriesDetailUI();
      hydratePosters();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (activeHub === "donghua") {
        return openWatchPlayer(id, fbTitle || id, id, 1);
      }
      document.getElementById("viewContainer").innerHTML = `
        <div class="surface-card" style="text-align:center;">
          <p style="margin-bottom:12px;">Gagal memuat detail tayangan.</p>
          <button class="btn" onclick="openHub('${activeHub}')">Kembali</button>
        </div>
      `;
    }
  }

  function renderSeriesDetailUI() {
    const s = currentSeries;
    const saved = isItemSaved(s.id);
    const totalEps = currentEpisodes.length;

    let rangeTabsHTML = "";
    if (totalEps > 50) {
      const chunks = Math.ceil(totalEps / 50);
      let tabs = "";
      for (let i = 0; i < chunks; i++) {
        const start = i * 50 + 1;
        const end = Math.min((i + 1) * 50, totalEps);
        tabs += '<button class="chip ' + (activeEpRange === i ? "active" : "") + '" onclick="setEpRange(' + i + ')">' + start + " - " + end + "</button>";
      }
      rangeTabsHTML = '<div class="filter-bar" style="margin-bottom:12px;">' + tabs + "</div>";
    }

    document.getElementById("viewContainer").innerHTML = `
      <div class="surface-card">
        <div class="detail-grid">
          <div class="detail-cover">
            <img class="lazy-poster" src="${escapeHTML(s.poster)}" data-title="${escapeHTML(s.title)}" alt="" referrerpolicy="no-referrer" onerror="window.onImgErr(this)">
          </div>
          <div class="detail-content">
            <h1>${escapeHTML(s.title)}</h1>
            <p class="detail-synopsis">${escapeHTML(s.synopsis)}</p>
            <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:inherit;">
              ${
                totalEps > 0
                  ? `<button class="btn primary" onclick="openWatchPlayer('${escapeHTML(currentEpisodes[0].epId)}', '${escapeHTML(currentEpisodes[0].fullTitle)}', '${escapeHTML(s.id)}',${s.category})">
                      <i class="fa-solid fa-play"></i> Mulai Nonton (${escapeHTML(currentEpisodes[0].label)})
                    </button>`
                  : ""
              }
              <button class="btn" id="saveSeriesBtn" onclick="toggleSaveCurrent()">
                <i class="fa-${saved ? "solid" : "regular"} fa-bookmark"></i> ${saved ? "Tersimpan" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="surface-card">
        <div class="section-header">
          <h2>Daftar Episode (${totalEps})</h2>
          <input type="text" placeholder="Cari nomor ep..." style="background:var(--bg-elevated);border:1px solid var(--border-subtle);color:#fff;padding:7px 12px;border-radius:8px;font-size:12.5px;width:155px;outline:none;" oninput="searchEpisodeNumber(this.value)">
        </div>
        ${rangeTabsHTML}
        <div class="ep-grid" id="epGridList"></div>
      </div>
    `;

    renderEpisodeChunk();
  }

  function setEpRange(rangeIndex) {
    activeEpRange = rangeIndex;
    renderSeriesDetailUI();
  }

  function renderEpisodeChunk(customList) {
    const box = document.getElementById("epGridList");
    if (!box) return;
    const slice = customList || currentEpisodes.slice(activeEpRange * 50, (activeEpRange + 1) * 50);

    if (slice.length === 0) {
      box.innerHTML = '<p style="color:var(--text-secondary); grid-column:1/-1;">Episode tidak ditemukan.</p>';
      return;
    }

    box.innerHTML = slice
      .map(function (ep) {
        const watched = isEpWatched(currentSeries.hub + "_" + ep.epId);
        return `
          <button class="ep-item ${watched ? "watched" : ""}" onclick="openWatchPlayer('${escapeHTML(ep.epId)}', '${escapeHTML(ep.fullTitle)}', '${escapeHTML(ep.contentId)}', ${ep.category})">
            ${watched ? '<i class="fa-solid fa-check" style="font-size:10px;margin-right:3px;"></i>' : ""}${escapeHTML(ep.label)}
          </button>
        `;
      })
      .join("");
  }

  function searchEpisodeNumber(q) {
    const clean = q.trim().toLowerCase();
    if (!clean) return renderEpisodeChunk();
    const filtered = currentEpisodes.filter(function (ep) { return ep.label.toLowerCase().includes(clean); });
    renderEpisodeChunk(filtered);
  }

  async function openWatchPlayer(epId, epTitle, seriesId, category) {
    if (!epId) return;
    const cat = category !== undefined ? category : 1;
    destroyHls();
    markEpWatched(activeHub + "_" + epId);

    if (currentSeries) {
      recordWatchHistory({
        hub: activeHub,
        seriesId: seriesId || currentSeries.id,
        title: currentSeries.title,
        epLabel: cleanEpNumber(epTitle, 1),
        category: cat
      });
    }

    setBreadcrumb([
      { label: "Lobby", action: "openHub('lobby')" },
      { label: activeHub.toUpperCase(), action: "openHub('" + activeHub + "')" },
      { label: "Pemutar Video", action: "" }
    ]);

    document.getElementById("viewContainer").innerHTML = '<div class="surface-card" style="text-align:center; padding:40px;">Menyiapkan aliran video...</div>';

    try {
      if (activeHub === "loklok") {
        const cId = seriesId || currentSeries?.id || "";
        const lkJson = await irohaFetch(
          "/v1/loklok?action=stream&id=" + encodeURIComponent(cId) + "&vid=" + encodeURIComponent(epId) + "&category=" + encodeURIComponent(cat) + "&definition=GROOT_HD"
        );
        const d = lkJson?.data || lkJson?.result || {};
        const mainUrl = d.mediaUrl || d.url || d.watchUrl || "";
        const qualities = Array.isArray(d.qualities) ? d.qualities : [];

        activeServers = qualities.length > 0
          ? qualities.map(function (q, i) { return { name: q.quality || q.definition || "Kualitas " + (i + 1), url: q.mediaUrl || q.url }; })
          : [{ name: "GROOT HD", url: mainUrl }];

        return renderWatchStage({
          title: epTitle || currentSeries?.title || "Pemutar Film & Drama",
          seriesId: cId,
          category: cat,
          initialUrl: mainUrl,
          prevEp: "",
          nextEp: ""
        });
      }

      if (activeHub === "donghua") {
        const dJson = await irohaFetch("/v1/donghub?action=watch&slug=" + encodeURIComponent(epId));
        const d = dJson?.data || dJson?.result || {};
        const servers = Array.isArray(d.servers) ? d.servers : [];
        activeServers = servers.map(function (s, i) { return { name: s.name || "Server " + (i + 1), url: s.url }; });

        return renderWatchStage({
          title: cleanTitle(d.title || epTitle) + " - " + cleanEpNumber(d.title || epTitle, 1),
          seriesId: seriesId || d.seriesSlug || "",
          category: 1,
          initialUrl: d.videoUrl || servers[0]?.url || "",
          prevEp: d.prevEpisode || "",
          nextEp: d.nextEpisode || ""
        });
      }

      const aJson = await irohaFetch("/v1/anime/streaming/episode/" + encodeURIComponent(epId));
      const d = aJson?.data?.details || aJson?.data || aJson || {};
      let srvList = [];
      if (Array.isArray(d.server?.qualities)) {
        d.server.qualities.forEach(function (q) {
          (q.serverList || []).forEach(function (s) {
            srvList.push({
              name: (s.title || "Server") + " (" + (q.title || "HD") + ")",
              sid: s.serverId || s.sid || s.id || "",
              url: s.url || "",
              ep: epId
            });
          });
        });
      } else if (Array.isArray(d.servers || d.serverList)) {
        srvList = (d.servers || d.serverList).map(function (s, i) {
          return {
            name: s.name || s.title || "Server " + (i + 1),
            sid: s.serverId || s.sid || s.id || "",
            url: s.url || "",
            ep: epId
          };
        });
      }

      activeServers = srvList;
      const initialStream = d.defaultStreamingUrl || d.streamUrl || d.videoUrl || d.hlsUrl || "";

      renderWatchStage({
        title: d.title || epTitle || epId,
        seriesId: seriesId || d.animeId || currentSeries?.id || "",
        category: 1,
        initialUrl: initialStream,
        prevEp: d.prevEpisode?.episodeId || d.prevEpisode || "",
        nextEp: d.nextEpisode?.episodeId || d.nextEpisode || ""
      });

      if (!initialStream && activeServers.length > 0) {
        switchVideoServer(0);
      }
    } catch (err) {
      document.getElementById("viewContainer").innerHTML = `
        <div class="surface-card" style="text-align:center;">
          <p style="margin-bottom:12px;">Maaf, aliran video untuk episode ini sedang tidak tersedia.</p>
          <button class="btn" onclick="openHub('${activeHub}')">Kembali ke Katalog</button>
        </div>
      `;
    }
  }

  function renderWatchStage(cfg) {
    const srvBtns = activeServers
      .map(function (s, idx) {
        return '<button class="chip srv-chip ' + (idx === 0 ? "active" : "") + '" onclick="switchVideoServer(' + idx + ')">' + escapeHTML(s.name) + "</button>";
      })
      .join("");

    document.getElementById("viewContainer").innerHTML = `
      <div class="surface-card player-wrapper">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
          <div style="display:flex; gap:8px;">
            ${
              cfg.seriesId
                ? `<button class="btn" onclick="openSeriesDetail('${escapeHTML(cfg.seriesId)}',${cfg.category})"><i class="fa-solid fa-list"></i> Daftar Episode</button>`
                : `<button class="btn" onclick="openHub('${activeHub}')"><i class="fa-solid fa-arrow-left"></i> Kembali</button>`
            }
            <button class="btn" onclick="toggleCinemaLights()"><i class="fa-regular fa-lightbulb"></i> Mode Bioskop</button>
          </div>
          <div style="display:flex; gap:8px;">
            ${cfg.prevEp ? `<button class="btn" onclick="openWatchPlayer('${escapeHTML(cfg.prevEp)}', '', '${escapeHTML(cfg.seriesId)}',${cfg.category})"><i class="fa-solid fa-backward-step"></i> Sebelumnya</button>` : ""}
            ${cfg.nextEp ? `<button class="btn primary" onclick="openWatchPlayer('${escapeHTML(cfg.nextEp)}', '', '${escapeHTML(cfg.seriesId)}',${cfg.category})">Selanjutnya <i class="fa-solid fa-forward-step"></i></button>` : ""}
          </div>
        </div>

        <h2 style="font-size:17px; font-weight:700; margin-bottom:10px;">${escapeHTML(cfg.title)}</h2>
        <div class="video-box" id="videoBoxStage"></div>

        ${srvBtns ? `<div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">Pilih Server / Resolusi:</div><div class="filter-bar" style="margin-bottom:0;">${srvBtns}</div>` : ""}
      </div>
    `;

    if (cfg.initialUrl) {
      playStreamUrl(cfg.initialUrl);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function switchVideoServer(idx) {
    const srv = activeServers[idx];
    if (!srv) return;
    document.querySelectorAll(".srv-chip").forEach(function (b, i) { b.classList.toggle("active", i === idx); });

    const stage = document.getElementById("videoBoxStage");
    if (stage) {
      stage.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;">Menghubungkan ke ' + escapeHTML(srv.name) + "...</div>";
    }

    try {
      if (srv.url && !srv.sid) {
        return playStreamUrl(srv.url);
      }
      const resJson = await irohaFetch(
        "/v1/anime/streaming/server-stream?sid=" + encodeURIComponent(srv.sid) + "&ep=" + encodeURIComponent(srv.ep || "")
      );
      const d = resJson?.data || resJson || {};
      const targetUrl = d.manifestUrl || d.hlsUrl || d.url || d.streamingUrl || d.embedUrl || "";
      if (targetUrl) playStreamUrl(targetUrl);
    } catch (e) {
      if (srv.url) playStreamUrl(srv.url);
    }
  }

  function destroyHls() {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  }

  function playStreamUrl(rawUrl) {
    destroyHls();
    const stage = document.getElementById("videoBoxStage");
    if (!stage || !rawUrl) return;

    let finalUrl = rawUrl;
    if (finalUrl.startsWith("/")) {
      finalUrl = DIRECT_BASE + finalUrl + (finalUrl.includes("?") ? "&" : "?") + "apikey=" + FALLBACK_KEY;
    }

    const isDirectVideo =
      finalUrl.includes(".m3u8") ||
      finalUrl.includes("/stream/manifest") ||
      finalUrl.includes(".mp4");

    if (isDirectVideo) {
      stage.innerHTML = '<video id="activeVideoEl" controls autoplay playsinline></video>';
      const video = document.getElementById("activeVideoEl");

      if ((finalUrl.includes(".m3u8") || finalUrl.includes("/stream/manifest")) && window.Hls && window.Hls.isSupported()) {
        hlsInstance = new window.Hls({ enableWorker: true });
        hlsInstance.loadSource(finalUrl);
        hlsInstance.attachMedia(video);
      } else {
        video.src = finalUrl;
      }
    } else {
      stage.innerHTML = '<iframe src="' + escapeHTML(finalUrl) + '" allowfullscreen allow="autoplay; encrypted-media"></iframe>';
    }
  }

  function toggleCinemaLights() {
    lightsOff = !lightsOff;
    const dim = document.getElementById("cinemaDim");
    if (dim) dim.classList.toggle("active", lightsOff);
  }

  function renderSavedView() {
    setBreadcrumb([{ label: "Lobby", action: "openHub('lobby')" }, { label: "Daftar Tersimpan", action: "" }]);
    const fc = document.getElementById("filterContainer");
    if (fc) fc.innerHTML = "";
    const list = getSavedList();
    const view = document.getElementById("viewContainer");

    if (list.length === 0) {
      view.innerHTML = '<div class="surface-card" style="text-align:center; padding:40px;">Belum ada tayangan yang disimpan.</div>';
      return;
    }

    const cards = list
      .map(function (item) {
        return `
      <div class="media-card" onclick="resumeHistoryItem('${escapeHTML(item.hub)}', '${escapeHTML(item.id)}', '${escapeHTML(item.category || 1)}')">
        <div class="poster-wrap">
          <span class="badge-overlay">${escapeHTML(item.badge || "Tersimpan")}</span>
          <img class="lazy-poster" src="${escapeHTML(item.poster)}" data-title="${escapeHTML(item.title)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="window.onImgErr(this)">
        </div>
        <div class="media-info">
          <div class="media-title">${escapeHTML(item.title)}</div>
        </div>
      </div>
    `;
      })
      .join("");

    view.innerHTML = `
      <div class="section-header">
        <h2>Daftar Tayangan Tersimpan (${list.length})</h2>
        <button class="btn" onclick="localStorage.removeItem('kh_saved_list'); renderSavedView();">Kosongkan</button>
      </div>
      <div class="poster-grid">${cards}</div>
    `;
    hydratePosters();
  }

  function renderHistoryView() {
    setBreadcrumb([{ label: "Lobby", action: "openHub('lobby')" }, { label: "Riwayat Tontonan", action: "" }]);
    const fc = document.getElementById("filterContainer");
    if (fc) fc.innerHTML = "";
    const list = getWatchHistory();
    const view = document.getElementById("viewContainer");

    if (list.length === 0) {
      view.innerHTML = '<div class="surface-card" style="text-align:center; padding:40px;">Belum ada riwayat tontonan.</div>';
      return;
    }

    view.innerHTML = `
      <div class="surface-card">
        <div class="section-header">
          <h2>Riwayat Tontonan Terakhir</h2>
          <button class="btn" onclick="localStorage.removeItem('kh_watch_history'); renderHistoryView();">Bersihkan Riwayat</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${list
            .map(function (h) {
              return `
            <div class="btn" style="justify-content:space-between; padding:14px;" onclick="resumeHistoryItem('${escapeHTML(h.hub)}', '${escapeHTML(h.seriesId)}', '${escapeHTML(h.category || 1)}')">
              <div>
                <div style="font-weight:700; font-size:14px;">${escapeHTML(h.title)}</div>
                <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${escapeHTML(h.epLabel)} &bull; Ruang${escapeHTML(h.hub.toUpperCase())}</div>
              </div>
              <span style="font-size:12px; color:var(--accent);">${escapeHTML(h.time)} <i class="fa-solid fa-chevron-right"></i></span>
            </div>
          `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  Object.assign(window, {
    openHub: openHub,
    loadHubCatalog: loadHubCatalog,
    selectLoklokNav: selectLoklokNav,
    loadWattpadTopic: loadWattpadTopic,
    selectAnimeGenre: selectAnimeGenre,
    submitSearch: submitSearch,
    openSeriesDetail: openSeriesDetail,
    setEpRange: setEpRange,
    searchEpisodeNumber: searchEpisodeNumber,
    openWatchPlayer: openWatchPlayer,
    switchVideoServer: switchVideoServer,
    toggleCinemaLights: toggleCinemaLights,
    toggleSaveCurrent: toggleSaveCurrent,
    resumeHistoryItem: resumeHistoryItem,
    renderSavedView: renderSavedView,
    renderHistoryView: renderHistoryView,
    onImgErr: onImgErr
  });

  function boot() {
    try {
      injectStyles();
      renderLayout();
      openHub("lobby");
    } catch (err) {
      document.body.innerHTML = '<div style="padding:24px;color:#fff;background:#0b0d14;">Gagal memuat skrip: ' + err.message + "</div>";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
