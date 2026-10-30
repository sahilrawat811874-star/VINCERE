/**
 * Swasthya - Production Structured JSON Logger Middleware
 */

function formatLog(level, data) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...data
  });
}

function requestLogger(req, res, next) {
  const start = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const method = req.method;
  const url = req.url;

  // On response completion, log structured record
  const finishHandler = () => {
    res.removeListener('finish', finishHandler);
    res.removeListener('close', finishHandler);

    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    console.log(formatLog(level, {
      method,
      url,
      status: statusCode,
      duration_ms: duration,
      ip: typeof ip === 'string' ? ip.split(',')[0].trim() : ip
    }));
  };

  res.on('finish', finishHandler);
  res.on('close', finishHandler);

  if (next) next();
}

module.exports = {
  requestLogger,
  formatLog
};

