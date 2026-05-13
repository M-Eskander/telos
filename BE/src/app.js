require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('./middleware/auth.middleware');
const authRouter = require('./routes/authRouter');
const projectRouter = require('./routes/projectRouter');
const startServer = require('./utils/startServer');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// mount auth router under API base
app.use('/api/auth', authRouter);
app.use('/api/projects', projectRouter);
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
