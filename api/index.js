const app = require('../server');

export default function handler(req, res) {
  return app(req, res);
}
