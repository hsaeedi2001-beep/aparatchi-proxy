import http from "http";
import { URL } from "url";

const PORT = process.env.PORT || 3000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REFERER = "https://www.aparatchii.com/";

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    let target = reqUrl.searchParams.get("url") || "https://gg.hls2.xyz/live2/tv33/playlist.m3u8";

    // Get fresh signed URL from token.php
    if (!target.includes("wmsAuthSign=")) {
      const tokenRes = await fetch("https://www.aparatchii.com/token.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
          "Referer": REFERER,
          "Origin": "https://www.aparatchii.com",
        },
        body: "video_url=" + encodeURIComponent(target),
      });

      if (!tokenRes.ok) {
        res.writeHead(502);
        return res.end("token.php error: " + tokenRes.status);
      }

      const data = await tokenRes.json();
      if (!data?.url) {
        res.writeHead(502);
        return res.end("No signed URL");
      }
      target = data.url;
    }

    const upstreamHeaders = {
      "User-Agent": UA,
      "Referer": "https://www.aparatchii.com/irib-live-tv/irib3-live",
      "Origin": "https://www.aparatchii.com",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
    };

    if (req.headers.range) {
      upstreamHeaders["Range"] = req.headers.range;
    }

    const response = await fetch(target, {
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!response.ok) {
      res.writeHead(response.status);
      return res.end(`Upstream error ${response.status}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const isM3U8 = contentType.includes("mpegurl") || contentType.includes("m3u8") || target.includes(".m3u8");

    if (isM3U8) {
      let text = await response.text();
      const base = target.substring(0, target.lastIndexOf("/") + 1);
      const proxyBase = `https://${req.headers.host}${reqUrl.pathname}`;

      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          line = line.trim();
          if (!line) return line;

          if (line.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
              const abs = new URL(uri, base).href;
              return `URI="${proxyBase}?url=${encodeURIComponent(abs)}"`;
            });
          }

          const abs = line.startsWith("http") ? line : new URL(line, base).href;
          return `${proxyBase}?url=${encodeURIComponent(abs)}`;
        })
        .join("\n");

      res.writeHead(200, {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(rewritten);
    }

    // Binary segments (.ts)
    res.writeHead(response.status, {
      "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=10",
    });

    const buffer = await response.arrayBuffer();
    res.end(Buffer.from(buffer));
  } catch (err) {
    res.writeHead(500);
    res.end("Error: " + err.message);
  }
});

server.listen(PORT, () => {
  console.log("Proxy running on port", PORT);
});
