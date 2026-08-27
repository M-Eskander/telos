const DEFAULT_CAPACITY = 150;
const DEFAULT_REFILL_RATE = DEFAULT_CAPACITY / (15 * 60);

function normalizePrefixes(endpointPrefixes) {
  const prefixes = Array.isArray(endpointPrefixes) ? endpointPrefixes : [endpointPrefixes];

  return prefixes
    .filter((prefix) => typeof prefix === 'string' && prefix.length > 0)
    .map((prefix) => prefix.length > 1 ? prefix.replace(/\/$/, '') : prefix);
}

function matchesPrefix(path, prefix) {
  return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
}

function createTokenBucketRateLimiter(endpointPrefixes, options = {}) {
  if (endpointPrefixes && !Array.isArray(endpointPrefixes) && typeof endpointPrefixes === 'object') {
    options = endpointPrefixes;
    endpointPrefixes = options.endpointPrefixes;
  }

  const prefixes = normalizePrefixes(endpointPrefixes);
  if (prefixes.length === 0) {
    throw new Error('At least one endpoint prefix is required');
  }

  const capacity = options.capacity || DEFAULT_CAPACITY;
  const refillRate = options.refillRate || DEFAULT_REFILL_RATE;
  const keyGenerator = options.keyGenerator || ((req) => req.ip);
  const buckets = new Map();

  if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(refillRate) || refillRate <= 0) {
    throw new Error('capacity and refillRate must be positive numbers');
  }

  function getBucket(key, now) {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      buckets.set(key, bucket);
    }

    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillRate);
    bucket.lastRefill = now;
    return bucket;
  }

  function limiter(req, res, next) {
    const matchedPrefix = prefixes.find((prefix) => matchesPrefix(req.path, prefix));
    if (!matchedPrefix) {
      return next();
    }

    const now = Date.now();
    const bucketKey = `${matchedPrefix}:${keyGenerator(req)}`;
    const bucket = getBucket(bucketKey, now);
    const remaining = Math.max(0, Math.floor(bucket.tokens));

    res.set('RateLimit-Limit', String(Math.floor(capacity)));
    res.set('RateLimit-Remaining', String(remaining));

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate);
      res.set('RateLimit-Reset', String(Math.ceil(now / 1000) + retryAfter));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: options.message || 'Too many requests, please try again later.' });
    }

    bucket.tokens -= 1;
    res.set('RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    res.set('RateLimit-Reset', String(Math.ceil(now / 1000) + Math.ceil((capacity - bucket.tokens) / refillRate)));
    return next();
  }

  limiter.reset = () => buckets.clear();
  return limiter;
}

module.exports = createTokenBucketRateLimiter;
module.exports.createTokenBucketRateLimiter = createTokenBucketRateLimiter;