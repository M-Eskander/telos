// Load env only if an earlier bootstrap hasn't already loaded dotenv (tests)
if (!process.env.__DOTENV_LOADED) {
  require('dotenv').config();
}
const express = require('express');
const session = require('express-session');
// `connect-redis` exports a `RedisStore` class under the `RedisStore` property.
// Use that directly to construct the store instance.
const RedisStore = require('connect-redis').RedisStore;
const redisClient = require('./redis/client');
const passport = require('./middleware/auth.middleware');
const authRouter = require('./routes/auth.router');
const projectRouter = require('./routes/project.router');
const accessControlRouter = require('./routes/accessControl.router');
const startServer = require('./utils/startServer');
const createTokenBucketRateLimiter = require('./middleware/rateLimit.middleware');
const createSessionConfig = require('./config/session.config');
const helmet = require('helmet');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());

// The API budget is counted per signed-in person, not per connection, so a
// studio working from one address does not lock each other out. Anonymous
// traffic (signing in) falls back to the address.
const API_BUDGET = 600;
const apiRateLimiter = createTokenBucketRateLimiter(['/api/'], {
  capacity: API_BUDGET,
  refillRate: API_BUDGET / (15 * 60),
  keyGenerator: (req) => (req.user && req.user.id ? `user:${req.user.id}` : `ip:${req.ip}`)
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionConfig = createSessionConfig(process.env, redisClient, RedisStore);
if (sessionConfig.store) {
  console.log('Session store: Redis');
} else {
  console.warn('Session store: In-memory (development/test only)');
}

app.use(session(sessionConfig));

app.use(passport.initialize());
app.use(passport.session());

// Runs after the session so the limiter can tell people apart.
app.use(apiRateLimiter);

// mount auth router under API base
app.use('/api/auth', authRouter);
app.use('/api/projects', projectRouter);
app.use('/api/admin', accessControlRouter);
// Environment variables
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Routes
app.get('/api', (req, res) => {
  res.json({ message: 'Server is running', environment: NODE_ENV });
});


// Development helper: list registered routes
if (NODE_ENV === 'development') {
  app.get('/api/routes', (req, res) => {
    const routes = [];
    const stack = app._router && app._router.stack ? app._router.stack : [];
    stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        routes.push({ path: layer.route.path, methods: Object.keys(layer.route.methods) });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        layer.handle.stack.forEach((handler) => {
          if (handler.route && handler.route.path) {
            routes.push({ path: handler.route.path, methods: Object.keys(handler.route.methods) });
          }
        });
      }
    });
    res.json({ routes });
  });
}




// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

if (require.main === module) {
  startServer(app);
}

module.exports = app;
