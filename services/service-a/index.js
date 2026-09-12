const express = require('express');
const app = express();
const PORT = process.env.PORT || 4001;

// Pretend this is a real "products" microservice. The gateway is the
// only thing that talks to it directly - clients never see this port.
app.get('/products', (req, res) => {
  res.json({
    service: 'service-a',
    products: [
      { id: 1, name: 'Wireless mouse', price: 799 },
      { id: 2, name: 'Mechanical keyboard', price: 3499 },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`service-a listening on port ${PORT}`);
});
