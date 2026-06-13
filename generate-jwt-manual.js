const jwt = require('jsonwebtoken');

const secret = 'f57e9cdf5cb8d310592966897b3c029e09202c8af8924db47edc3a9070232006';

// Payload for user ID 2
const payload = {
  id: 2
};

const token = jwt.sign(payload, secret, {
  expiresIn: '30d'
});

console.log('JWT_TOKEN:', token);
