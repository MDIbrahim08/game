const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { snapshot, route } = require("./game-core");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = __dirname;

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

function joinUrl(req) {
  const host = req.headers.host && !req.headers.host.startsWith("localhost")
    ? req.headers.host
    : `${getLanIp()}:${PORT}`;
  return `http://${host}/?player=1`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const filePath = url.pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
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
    const ext = path.extname(filePath);
    const type = ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/game") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snapshot(joinUrl(req))));
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const result = route(url.searchParams.get("action"), body);
      res.writeHead(result.ok === false ? 409 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
  }

  serveFile(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SecureCraft running on http://localhost:${PORT}`);
  console.log(`Phone join URL: http://${getLanIp()}:${PORT}/?player=1`);
});
