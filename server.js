const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { snapshot, route } = require("./game-core");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

function lanIp() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

function joinUrl(req) {
  const host = req.headers.host && !req.headers.host.startsWith("localhost") ? req.headers.host : `${lanIp()}:${PORT}`;
  return `http://${host}/?player=1`;
}

function body(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => raw += chunk);
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function file(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const filePath = url.pathname === "/" ? path.join(ROOT, "index.html") : path.join(ROOT, url.pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": filePath.endsWith(".html") ? "text/html" : "text/plain" });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/game") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snapshot(joinUrl(req))));
      return;
    }
    if (req.method === "POST") {
      const result = route(url.searchParams.get("action"), await body(req));
      res.writeHead(result.ok === false ? 409 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
  }
  file(req, res);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`CodeSecure Escape Room: http://localhost:${PORT}`);
  console.log(`Join: http://${lanIp()}:${PORT}/?player=1`);
});
