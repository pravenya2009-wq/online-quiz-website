// Express 4 does not catch errors thrown inside async routes, so we wrap them.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
