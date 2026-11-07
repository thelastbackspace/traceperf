// The "pricing service": a separate process, like a real downstream API
const http = require('http');
const server = http.createServer((req, res) => setTimeout(() => res.end(JSON.stringify({ price: 10 })), 2));
server.listen(0, '127.0.0.1', () => process.send(server.address().port));
