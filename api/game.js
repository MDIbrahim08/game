const { snapshot, route } = require("../game-core");

module.exports = async function handler(req, res) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const joinUrl = `${protocol}://${req.headers.host}/?player=1`;

  if (req.method === "GET") {
    res.status(200).json(snapshot(joinUrl));
    return;
  }

  if (req.method === "POST") {
    const result = route(req.query.action, req.body || {});
    res.status(result.ok === false ? 409 : 200).json(result);
    return;
  }

  res.status(405).json({ ok: false });
};
