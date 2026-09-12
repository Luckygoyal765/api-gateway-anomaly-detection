const express = require('express');
const app = express();
const PORT = process.env.PORT || 4002;

// Pretend this is a real "orders" microservice.
app.get('/orders', (req, res) => {
  res.json({
    service: 'service-b',
    orders: [
      { id: 101, item: 'Wireless mouse', status: 'shipped' },
      { id: 102, item: 'Mechanical keyboard', status: 'processing' },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`service-b listening on port ${PORT}`);
});
