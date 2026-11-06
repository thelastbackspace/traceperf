// Tiny router shared by the example apps (plain node:http, no framework)
const http = require('http');

module.exports = function serve(routes) {
  const server = http.createServer(async (req, res) => {
    const handler = routes[req.url.split('?')[0]];
    if (!handler) {
      res.statusCode = 404;
      return res.end('not found');
    }
    try {
      const body = await handler(req);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    } catch (error) {
      res.statusCode = 500;
      res.end(error.message);
    }
  });
  server.listen(Number(process.env.PORT) || 0, () => {
    if (!process.env.QUIET) console.log(`listening on http://localhost:${server.address().port}`);
  });
  return server;
};
