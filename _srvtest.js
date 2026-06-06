const { create_app } = require("./server_race_results_transform_8018.js");
const http = require("http");
const app = create_app();
const s = app.listen(0, () => {
  const port = s.address().port;
  const paths = ["/", "/index.html", "/css/app.css", "/js/app.js", "/engine/schema.js", "/engine/io.js", "/vendor/exceljs.min.js", "/api/status"];
  let i = 0;
  function next() {
    if (i >= paths.length) { s.close(); return; }
    const p = paths[i++];
    http.get("http://127.0.0.1:" + port + p, (res) => {
      let len = 0; res.on("data", (c) => len += c.length); res.on("end", () => {
        console.log(String(res.statusCode) + "  " + (res.headers["content-type"] || "-").split(";")[0].padEnd(26) + " " + len + "B  " + p);
        next();
      });
    }).on("error", (e) => { console.log("ERR " + p + " " + e.message); next(); });
  }
  next();
});
