const MIN_PRODUCTION_SECRET_LENGTH = 32;

function createSessionConfig(env, redisClient, RedisStore) {
  const isProduction = env.NODE_ENV === 'production';
  const secret = env.SESSION_SECRET;
  if (isProduction && (
    typeof secret !== 'string' ||
    secret.length < MIN_PRODUCTION_SECRET_LENGTH ||
    secret === 'change_this_secret'
  )) {
    throw new Error('Production requires a SESSION_SECRET of at least 32 characters');
  }

  const config = {
    secret: secret || 'development-only-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    }
  };

  if (isProduction) {
    config.store = new RedisStore({ client: redisClient });
  }

  return config;
}

module.exports = createSessionConfig;
