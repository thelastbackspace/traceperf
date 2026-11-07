// Planted cause: GET /products calls the pricing service once per product
// (an N+1 over HTTP) instead of one batched /prices?ids=... call.
const { fork } = require('child_process');
const path = require('path');
const serve = require('../serve');

// Not traced: started without traceperf's --require (execArgv cleared)
const pricing = fork(path.join(__dirname, 'pricing.js'), { execArgv: [], env: { ...process.env, NODE_OPTIONS: '' } });
process.on('exit', () => pricing.kill());
pricing.once('message', port => {
  serve({
    '/products': async () => {
      const products = Array.from({ length: 10 }, (_, id) => ({ id }));
      for (const product of products) {
        const res = await fetch(`http://127.0.0.1:${port}/price?id=${product.id}`);
        product.price = (await res.json()).price;
      }
      return products;
    },
  });
});
