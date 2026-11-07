// Planted cause: every request serialises a ~1.5 MB catalogue (~8-15 ms of
// CPU each, never long enough to count as "blocking"), so throughput is
// capped by CPU, not by waiting.
const serve = require('../serve');

const catalogue = Array.from({ length: 6000 }, (_, i) => ({ id: i, name: `product ${i}`, tags: ['a', 'b', 'c'], price: i * 1.5, stock: { warehouse: i % 7, shelf: `s${i}` } }));

serve({
  '/catalogue': async () => JSON.parse(JSON.stringify(catalogue)),
});
