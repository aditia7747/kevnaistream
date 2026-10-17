export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const targetPath = req.query.path || "";

    const allowedPrefixes = [
      "/v1/anime/streaming",
      "/v1/donghub",
      "/v1/loklok",
      "/v1/wattpad"
    ];

    const isAllowed = allowedPrefixes.some((prefix) => targetPath.startsWith(prefix));
    if (!isAllowed) {
      return res.status(403).json({ ok: false, error: "Route tidak diizinkan" });
    }

    const API_KEY =
      process.env.IROHA_API_KEY ||
      "iroha_267d3ed4b6d2afa34b83e7aa6747ee35bd29c9d7eea10cd6";

    const upstreamUrl = `https://api.iroha-api.web.id${targetPath}`;

    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "X-API-Key": API_KEY,
        "Accept": "*/*",
        "User-Agent": "KevnaiCommunityHub/2.0"
      }
    });

    const contentType = response.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=600");

    const buffer = Buffer.from(await response.arrayBuffer());
    return res.status(response.status).send(buffer);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Gagal menghubungkan ke server pusat"
    });
  }
}
